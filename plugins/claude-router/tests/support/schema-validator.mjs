import assert from "node:assert/strict";

export function validateSchema(schema, value, definitionName = null) {
  const root = definitionName ? resolveRef(schema, `#/$defs/${definitionName}`) : schema;
  return validate(schema, root, value, definitionName ?? "root");
}

function validate(schema, node, value, location) {
  const errors = [];
  const schemaNode = node.$ref ? resolveRef(schema, node.$ref) : node;

  if (schemaNode.oneOf) {
    const matches = schemaNode.oneOf
      .map((candidate) => validate(schema, candidate, value, location))
      .filter((candidateErrors) => candidateErrors.length === 0);

    if (matches.length !== 1) {
      errors.push(`${location} must match exactly one schema, matched ${matches.length}`);
    }

    return errors;
  }

  if (schemaNode.enum && !schemaNode.enum.includes(value)) {
    errors.push(`${location} must be one of ${schemaNode.enum.join(", ")}`);
    return errors;
  }

  if (schemaNode.type && !matchesType(schemaNode.type, value)) {
    errors.push(`${location} must be ${formatType(schemaNode.type)}`);
    return errors;
  }

  if (isObject(value)) {
    const properties = schemaNode.properties ?? {};
    for (const key of schemaNode.required ?? []) {
      if (!Object.hasOwn(value, key)) {
        errors.push(`${location}.${key} is required`);
      }
    }

    if (schemaNode.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) {
          errors.push(`${location}.${key} is not allowed`);
        }
      }
    } else if (isObject(schemaNode.additionalProperties)) {
      for (const [key, childValue] of Object.entries(value)) {
        if (!Object.hasOwn(properties, key)) {
          errors.push(...validate(schema, schemaNode.additionalProperties, childValue, `${location}.${key}`));
        }
      }
    }

    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) {
        errors.push(...validate(schema, childSchema, value[key], `${location}.${key}`));
      }
    }
  }

  if (Array.isArray(value)) {
    if (schemaNode.minItems !== undefined && value.length < schemaNode.minItems) {
      errors.push(`${location} must have at least ${schemaNode.minItems} item(s)`);
    }

    if (schemaNode.items) {
      value.forEach((item, index) => {
        errors.push(...validate(schema, schemaNode.items, item, `${location}[${index}]`));
      });
    }
  }

  return errors;
}

function resolveRef(schema, ref) {
  const prefix = "#/$defs/";
  assert.ok(ref.startsWith(prefix), `unsupported schema ref: ${ref}`);
  const definitionName = ref.slice(prefix.length);
  assert.ok(schema.$defs[definitionName], `missing schema ref target: ${ref}`);
  return schema.$defs[definitionName];
}

function matchesType(type, value) {
  const types = Array.isArray(type) ? type : [type];
  return types.some((candidate) => {
    switch (candidate) {
      case "array":
        return Array.isArray(value);
      case "boolean":
        return typeof value === "boolean";
      case "integer":
        return Number.isInteger(value);
      case "null":
        return value === null;
      case "number":
        return typeof value === "number" && Number.isFinite(value);
      case "object":
        return isObject(value);
      case "string":
        return typeof value === "string";
      default:
        throw new Error(`unsupported schema type: ${candidate}`);
    }
  });
}

function formatType(type) {
  return Array.isArray(type) ? type.join(" or ") : type;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
