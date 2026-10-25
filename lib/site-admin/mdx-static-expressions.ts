type Expression = { type?: string; value?: unknown; name?: string; operator?: string; argument?: Expression; elements?: (Expression | null)[]; properties?: Expression[]; key?: Expression; computed?: boolean; method?: boolean; kind?: string; quasis?: { value?: { cooked?: string } }[]; expressions?: unknown[] };

/** MDX preview accepts data literals, never executable JavaScript or name lookup. */
export function staticMdxExpression(node: unknown): unknown {
  const expression = node as Expression;
  if (expression?.type === "Literal" && (expression.value === null || ["string", "number", "boolean"].includes(typeof expression.value))) return expression.value;
  if (expression?.type === "Identifier" && expression.name === "undefined") return undefined;
  if (expression?.type === "UnaryExpression" && ["+", "-"].includes(expression.operator || "")) {
    const value = staticMdxExpression(expression.argument);
    if (typeof value === "number") return expression.operator === "-" ? -value : value;
  }
  if (expression?.type === "ArrayExpression") return (expression.elements || []).map((element) => element ? staticMdxExpression(element) : null);
  if (expression?.type === "ObjectExpression") {
    const value: Record<string, unknown> = {};
    for (const property of expression.properties || []) {
      if (property.type !== "Property" || property.computed || property.method || property.kind !== "init") throw new Error("Preview supports literal properties only.");
      const key = property.key?.type === "Identifier" ? property.key.name : staticMdxExpression(property.key);
      if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Unsupported preview property.");
      value[key] = staticMdxExpression(property.value);
    }
    return value;
  }
  if (expression?.type === "TemplateLiteral" && !expression.expressions?.length) return expression.quasis?.map((part) => part.value?.cooked || "").join("") || "";
  throw new Error("Preview supports data literals, not executable expressions.");
}
