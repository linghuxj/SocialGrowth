const name = "__Host-sg_operator_session";
const trimOws = (value: string) => value.replace(/^[\t ]+|[\t ]+$/g, "");
// Preserve the ENTIRE value after the first '='. No percent/quote decoding,
// prefix acceptance, array merging or first-match choice of duplicate names.
export function operatorSessionTokenFrom(header: string | string[] | undefined): string {
  if (typeof header !== "string" || header.includes("\r") || header.includes("\n") || header.includes("\0")) return "";
  const matches = header.split(";").map(trimOws).filter(part => {
    const separator = part.indexOf("=");
    return trimOws(part.slice(0, separator < 0 ? part.length : separator)) === name;
  });
  const one = matches.length === 1 ? matches[0] : undefined;
  const value = one?.startsWith(`${name}=`) ? one.slice(name.length + 1) : "";
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : "";
}
