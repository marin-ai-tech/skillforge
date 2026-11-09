/** RFC 4515 filter assertion value escape: \ * ( ) NUL */
export function escapeLdapFilterValue(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    const code = value.charCodeAt(i);
    if (c === "\\") out += "\\5c";
    else if (c === "*") out += "\\2a";
    else if (c === "(") out += "\\28";
    else if (c === ")") out += "\\29";
    else if (code === 0) out += "\\00";
    else out += c;
  }
  return out;
}

export function buildUserFilter(template: string, username: string): string {
  return template.split("{username}").join(escapeLdapFilterValue(username));
}
