"""The fixed set of scopes a non-owner admin's access can be limited to.

Deliberately coarse (one scope per router, not per action) — this is meant
to answer "should this admin see/touch Users at all", not build a real
per-field ACL. The owner account is never subject to this; only admins
created with an explicit, non-null `permissions` list are restricted at
all (a null list — the default for every admin created before this
existed — means unrestricted, same as today)."""

PERMISSION_SCOPES = ("users", "hosts", "nodes", "cores", "groups", "settings")
