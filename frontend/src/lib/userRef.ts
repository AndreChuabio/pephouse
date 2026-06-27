// A stable per-browser identifier used as the Junction `client_user_id`.
// No auth in the hackathon build — this is enough to key a demo user.

const KEY = "pephouse_user_ref";

export function getUserRef(): string {
  let ref = localStorage.getItem(KEY);
  if (ref === null) {
    ref = `pephouse-${crypto.randomUUID()}`;
    localStorage.setItem(KEY, ref);
  }
  return ref;
}
