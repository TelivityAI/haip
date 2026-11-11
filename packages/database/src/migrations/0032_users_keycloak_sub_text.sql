-- users.keycloak_sub holds the IdP subject. Keycloak subjects are UUIDs, but a
-- generic OIDC provider's need not be (Zitadel's are numeric strings), and a
-- uuid column turns the lookup of such a subject into a 500. Widening to text
-- keeps every existing value and the users_keycloak_sub_idx index.
ALTER TABLE users
  ALTER COLUMN keycloak_sub TYPE text;
