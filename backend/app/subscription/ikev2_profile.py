"""Builds an iOS/macOS Configuration Profile (.mobileconfig) for a user's
IKEv2 host — the one-tap alternative to typing server/remote-ID/username
/password into Settings > VPN by hand. Connect On Demand ships enabled:
the manual "Connecting..." delay users perceive with IKEv2 happens before
the first packet even reaches the server (DNS + iOS's own connect flow,
confirmed by server-side charon logs completing full handshakes in well
under a second), so removing the manual tap is the actual fix.
"""
import uuid
from xml.sax.saxutils import escape

from app.models.host import Host
from app.models.user import ProxyUser

# Fixed namespace so the same user+host always gets the same PayloadUUIDs —
# reinstalling an unchanged profile updates it in place instead of piling
# up duplicate VPN entries on the device.
_NAMESPACE = uuid.UUID("6f6e9f2e-0f1a-4b7a-9c7a-1f6a8b2f9d3e")


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

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>IKEv2</key>
            <dict>
                <key>AuthenticationMethod</key>
                <string>None</string>
                <key>ExtendedAuthEnabled</key>
                <true/>
                <key>AuthName</key>
                <string>{escape(user.username)}</string>
                <key>AuthPassword</key>
                <string>{escape(user.secret)}</string>
                <key>RemoteAddress</key>
                <string>{escape(remote_address)}</string>
                <key>RemoteIdentifier</key>
                <string>{escape(remote_id)}</string>
                <key>LocalIdentifier</key>
                <string>{escape(user.username)}</string>
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
