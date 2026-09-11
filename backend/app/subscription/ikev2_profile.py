"""Builds an iOS/macOS Configuration Profile (.mobileconfig) for a user's
IKEv2 host — the one-tap alternative to typing server/remote-ID/username
/password into Settings > VPN by hand. Connect On Demand ships enabled:
the manual "Connecting..." delay users perceive with IKEv2 happens before
the first packet even reaches the server (DNS + iOS's own connect flow,
confirmed by server-side charon logs completing full handshakes in well
under a second), so removing the manual tap is the actual fix.
"""
import base64
import re
import uuid
from xml.sax.saxutils import escape

from cryptography import x509
from cryptography.hazmat.primitives.serialization import Encoding

from app.models.host import Host
from app.models.user import ProxyUser

# Fixed namespace so the same user+host always gets the same PayloadUUIDs —
# reinstalling an unchanged profile updates it in place instead of piling
# up duplicate VPN entries on the device.
_NAMESPACE = uuid.UUID("6f6e9f2e-0f1a-4b7a-9c7a-1f6a8b2f9d3e")

_PEM_CERT_RE = re.compile(r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", re.DOTALL)


def _ca_certificate_der(cert_pem: str | None) -> bytes | None:
    """`Core.ikev2_certificate` is the leaf cert with its issuing CA appended
    (see app/cores/ikev2_cert.py) — the last PEM block in it is that CA.
    A publicly-trusted certificate needs nothing extra, but a self-signed
    one has to have this CA bundled straight into the profile, or iOS/macOS
    silently reject the server's identity and the VPN just never connects."""
    blocks = _PEM_CERT_RE.findall(cert_pem or "")
    if len(blocks) < 2:
        return None
    ca_cert = x509.load_pem_x509_certificate(blocks[-1].encode())
    return ca_cert.public_bytes(Encoding.DER)


def _uuid_for(*parts: str) -> str:
    return str(uuid.uuid5(_NAMESPACE, "|".join(parts))).upper()


def build_ikev2_mobileconfig(user: ProxyUser, host: Host) -> str:
    remote_id = (host.core.ikev2_remote_id if host.core else None) or host.address
    # Connect by the same name the cert/AUTH round validates, not necessarily
    # the raw host.address on file (may just be the underlying IP) — avoids
    # relying on RemoteAddress/RemoteIdentifier mismatch behaving correctly
    # on every client.
    remote_address = remote_id or host.address
    vpn_uuid = _uuid_for("vpn", str(host.id), str(user.id))
    profile_uuid = _uuid_for("profile", str(host.id), str(user.id))
    display_name = escape(f"{host.remark} ({user.username})")

    is_psk = bool(host.core and host.core.ikev2_auth_mode == "psk")

    if is_psk:
        # Shared-secret mode (Core.ikev2_auth_mode == "psk", see
        # node_agent/ipsec.py): no certificate exchange at all, so no CA
        # trust payload either — every field below just carries the one
        # secret every user of this Host shares.
        psk_b64 = base64.b64encode((host.core.ikev2_psk or "").encode()).decode()
        auth_block = f"""                <key>AuthenticationMethod</key>
                <string>SharedSecret</string>
                <key>SharedSecret</key>
                <data>{psk_b64}</data>"""
        ca_payload = ""
        return _build_plist(display_name, vpn_uuid, profile_uuid, remote_id, remote_address, auth_block, ca_payload)

    ca_der = _ca_certificate_der(host.core.ikev2_certificate if host.core else None)
    ca_payload = ""
    if ca_der is not None:
        ca_uuid = _uuid_for("ca", str(host.id))
        ca_b64 = base64.b64encode(ca_der).decode()
        ca_payload = f"""        <dict>
            <key>PayloadCertificateFileName</key>
            <string>ca.cer</string>
            <key>PayloadContent</key>
            <data>{ca_b64}</data>
            <key>PayloadDescription</key>
            <string>Trusts the certificate authority this IKEv2 server signs its own certificate with</string>
            <key>PayloadDisplayName</key>
            <string>{display_name} Root CA</string>
            <key>PayloadIdentifier</key>
            <string>ir.tifusi.vpn.ca.{ca_uuid}</string>
            <key>PayloadType</key>
            <string>com.apple.security.root</string>
            <key>PayloadUUID</key>
            <string>{ca_uuid}</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
        </dict>
"""

    auth_block = f"""                <key>AuthenticationMethod</key>
                <string>None</string>
                <key>ExtendedAuthEnabled</key>
                <true/>
                <key>AuthName</key>
                <string>{escape(user.username)}</string>
                <key>AuthPassword</key>
                <string>{escape(user.secret)}</string>
                <key>LocalIdentifier</key>
                <string>{escape(user.username)}</string>"""
    return _build_plist(display_name, vpn_uuid, profile_uuid, remote_id, remote_address, auth_block, ca_payload)


def _build_plist(
    display_name: str,
    vpn_uuid: str,
    profile_uuid: str,
    remote_id: str,
    remote_address: str,
    auth_block: str,
    ca_payload: str,
) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
{ca_payload}        <dict>
            <key>IKEv2</key>
            <dict>
{auth_block}
                <key>RemoteAddress</key>
                <string>{escape(remote_address)}</string>
                <key>RemoteIdentifier</key>
                <string>{escape(remote_id)}</string>
                <key>DeadPeerDetectionRate</key>
                <string>Medium</string>
                <key>EnablePFS</key>
                <true/>
                <key>EnableCertificateRevocationCheck</key>
                <integer>0</integer>
                <key>UseConfigurationAttributeInternalIPSubnet</key>
                <integer>0</integer>
                <key>IKESecurityAssociationParameters</key>
                <dict>
                    <key>EncryptionAlgorithm</key>
                    <string>AES-256</string>
                    <key>IntegrityAlgorithm</key>
                    <string>SHA2-256</string>
                    <key>DiffieHellmanGroup</key>
                    <integer>14</integer>
                    <key>LifeTimeInMinutes</key>
                    <integer>1440</integer>
                </dict>
                <key>ChildSecurityAssociationParameters</key>
                <dict>
                    <key>EncryptionAlgorithm</key>
                    <string>AES-256</string>
                    <key>IntegrityAlgorithm</key>
                    <string>SHA2-256</string>
                    <key>DiffieHellmanGroup</key>
                    <integer>14</integer>
                    <key>LifeTimeInMinutes</key>
                    <integer>60</integer>
                </dict>
            </dict>
            <key>OnDemandEnabled</key>
            <integer>1</integer>
            <key>OnDemandRules</key>
            <array>
                <dict>
                    <key>Action</key>
                    <string>Connect</string>
                </dict>
            </array>
            <key>PayloadDescription</key>
            <string>Configures the {display_name} VPN connection</string>
            <key>PayloadDisplayName</key>
            <string>{display_name}</string>
            <key>PayloadIdentifier</key>
            <string>ir.tifusi.vpn.ikev2.{vpn_uuid}</string>
            <key>PayloadType</key>
            <string>com.apple.vpn.managed</string>
            <key>PayloadUUID</key>
            <string>{vpn_uuid}</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
            <key>Proxies</key>
            <dict>
                <key>HTTPEnable</key>
                <integer>0</integer>
                <key>HTTPSEnable</key>
                <integer>0</integer>
            </dict>
            <key>UserDefinedName</key>
            <string>{display_name}</string>
            <key>VPNType</key>
            <string>IKEv2</string>
        </dict>
    </array>
    <key>PayloadDisplayName</key>
    <string>{display_name}</string>
    <key>PayloadDescription</key>
    <string>IKEv2 VPN profile for {escape(remote_id)}, with Connect On Demand enabled</string>
    <key>PayloadIdentifier</key>
    <string>ir.tifusi.vpn.profile.{profile_uuid}</string>
    <key>PayloadOrganization</key>
    <string>Tifusi</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>{profile_uuid}</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>
"""
