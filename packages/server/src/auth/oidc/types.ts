export type OidcProviderConfig = {
  id: string;
  label: string;
  issuer: string;
  client_id: string;
  client_secret: string;
  scopes: string;
  role_claim: string | null;
  role_map: Record<string, string> | null;
  default_role: string;
};

export type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

export type PendingOidc = {
  providerId: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  next: string;
  expiresAt: number;
};
