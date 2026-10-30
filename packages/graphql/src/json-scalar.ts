import { GraphQLScalarType, Kind, type ValueNode } from 'graphql';

/** Opaque JSON for `where`, `json`, `richText`, arrays and blocks. */
export const GraphQLJSON = new GraphQLScalarType({
  name: 'JSON',
  description: 'Arbitrary JSON value',
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral: (ast) => parseNode(ast),
});

function parseNode(node: ValueNode): unknown {
  switch (node.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return node.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(node.value);
    case Kind.NULL:
      return null;
    case Kind.LIST:
      return node.values.map(parseNode);
    case Kind.OBJECT:
      return Object.fromEntries(
        node.fields.map((field) => [field.name.value, parseNode(field.value)]),
      );
    default:
      return null;
  }
}
