export type JsonSchema = Record<string, unknown>;

export type ToolExample = {
  input: unknown;
  output: unknown;
};

export type ToolSpec = {
  name: string;
  description: string;
  argsSchema: JsonSchema;
  returnsSchema: JsonSchema;
  examples?: ToolExample[];
  tags?: string[];
  filePath: string;
};
