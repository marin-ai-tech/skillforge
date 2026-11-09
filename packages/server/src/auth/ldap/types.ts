export type LdapProviderConfig = {
  id: string;
  label: string;
  url: string;
  bind_dn: string;
  bind_password: string;
  user_base: string;
  user_filter: string;
  username_attribute: string;
  display_name_attribute: string | null;
  email_attribute: string | null;
  group_attribute: string;
  role_map: Record<string, string> | null;
  default_role: string;
  timeout_ms: number;
  tls_ca_file: string | null;
};
