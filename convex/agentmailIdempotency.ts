const agentMailAllowedCharacter = /^[A-Za-z0-9.\-~]$/;

/**
 * Convert Jamanyo's internal semantic key into an AgentMail header value.
 *
 * AgentMail permits only letters, numbers, `-`, `.`, `_`, and `~`. We escape
 * underscores too, making this transformation reversible and collision-safe:
 * an internal `:` becomes `_3a_`, while an existing `_` becomes `__`.
 */
export function toAgentMailIdempotencyKey(value: string): string {
  if (!value) return "_empty_";

  let encoded = "";
  for (const character of value) {
    if (character === "_") {
      encoded += "__";
    } else if (agentMailAllowedCharacter.test(character)) {
      encoded += character;
    } else {
      encoded += `_${character.codePointAt(0)!.toString(16)}_`;
    }
  }
  return encoded;
}
