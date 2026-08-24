/**
 * @fileOverview A minimal Zod → JSON Schema converter.
 *
 * Genkit enforces the output shape itself, so this only matters for the providers
 * we call over raw HTTP (Groq), where the schema has to travel inside the prompt.
 *
 * Rather than take a dependency for this, it handles exactly the constructs used by
 * `ParsedResumeSchema` — objects, arrays, strings, numbers with min/max, and
 * optionals — and throws loudly on anything else. A converter that silently emits
 * `{}` for a construct it does not understand would produce a prompt that looks
 * fine and quietly stops constraining the model, which is the kind of failure that
 * shows up as an unexplained accuracy drop three experiments later.
 */

import type { ZodTypeAny } from 'zod';

export interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean;
}

interface ZodDefLike {
  typeName: string;
  innerType?: ZodTypeAny;
  schema?: ZodTypeAny;
  type?: ZodTypeAny;
  shape?: () => Record<string, ZodTypeAny>;
  checks?: Array<{ kind: string; value?: number }>;
  values?: string[];
}

function defOf(schema: ZodTypeAny): ZodDefLike {
  return (schema as unknown as { _def: ZodDefLike })._def;
}

export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  const def = defOf(schema);
  const description = (schema as unknown as { description?: string }).description;
  const withDescription = (js: JsonSchema): JsonSchema =>
    description ? { ...js, description } : js;

  switch (def.typeName) {
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
      return withDescription(zodToJsonSchema(def.innerType as ZodTypeAny));

    case 'ZodEffects':
      return withDescription(zodToJsonSchema(def.schema as ZodTypeAny));

    case 'ZodObject': {
      const shape = def.shape!();
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(child);
        if (!isOptional(child)) required.push(key);
      }
      return withDescription({
        type: 'object',
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: false,
      });
    }

    case 'ZodArray':
      return withDescription({
        type: 'array',
        items: zodToJsonSchema(def.type as ZodTypeAny),
      });

    case 'ZodString':
      return withDescription({ type: 'string' });

    case 'ZodNumber': {
      const out: JsonSchema = { type: 'number' };
      for (const check of def.checks ?? []) {
        if (check.kind === 'min') out.minimum = check.value;
        if (check.kind === 'max') out.maximum = check.value;
      }
      return withDescription(out);
    }

    case 'ZodBoolean':
      return withDescription({ type: 'boolean' });

    case 'ZodEnum':
      return withDescription({ type: 'string' });

    default:
      throw new Error(
        `zodToJsonSchema: unsupported Zod type "${def.typeName}". Add explicit support rather than letting it degrade to an unconstrained schema.`
      );
  }
}

function isOptional(schema: ZodTypeAny): boolean {
  const name = defOf(schema).typeName;
  return name === 'ZodOptional' || name === 'ZodDefault';
}
