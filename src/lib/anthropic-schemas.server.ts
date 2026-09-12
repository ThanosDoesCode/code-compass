const stringSchema = { type: "string" } as const;
const stringArraySchema = { type: "array", items: stringSchema } as const;
const difficultySchema = {
  type: "string",
  enum: ["beginner", "intermediate", "advanced"],
} as const;

/** Strict Anthropic structured-output schema for repository analysis. */
export const ANALYSIS_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "object",
      additionalProperties: false,
      properties: {
        whatItDoes: stringSchema,
        whoItsFor: stringSchema,
        projectType: stringSchema,
        beginnerMentalModel: stringSchema,
      },
      required: ["whatItDoes", "whoItsFor", "projectType", "beginnerMentalModel"],
    },
    technologies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: stringSchema,
          category: stringSchema,
          roleInRepository: stringSchema,
        },
        required: ["name", "category", "roleInRepository"],
      },
    },
    architecture: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: stringSchema,
          name: stringSchema,
          description: stringSchema,
          relatedFiles: stringArraySchema,
          connectsTo: stringArraySchema,
          concepts: stringArraySchema,
        },
        required: ["id", "name", "description", "relatedFiles", "connectsTo", "concepts"],
      },
    },
    importantFiles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: stringSchema,
          filename: stringSchema,
          category: stringSchema,
          whyItMatters: stringSchema,
          beginnerExplanation: stringSchema,
          difficulty: difficultySchema,
          recommendedOrder: { type: "integer" },
          concepts: stringArraySchema,
        },
        required: [
          "path",
          "filename",
          "category",
          "whyItMatters",
          "beginnerExplanation",
          "difficulty",
          "recommendedOrder",
          "concepts",
        ],
      },
    },
    conceptsToLearn: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: stringSchema,
          whyItMattersHere: stringSchema,
          prerequisites: stringArraySchema,
          relatedFiles: stringArraySchema,
          difficulty: difficultySchema,
          recommendedOrder: { type: "integer" },
        },
        required: [
          "name",
          "whyItMattersHere",
          "prerequisites",
          "relatedFiles",
          "difficulty",
          "recommendedOrder",
        ],
      },
    },
  },
  required: ["summary", "technologies", "architecture", "importantFiles", "conceptsToLearn"],
} as const;

/** Strict Anthropic structured-output schema for a concept deep dive. */
export const CONCEPT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: stringSchema,
    whatIsIt: stringSchema,
    whyDoesItExist: stringSchema,
    whyThisRepoUsesIt: stringSchema,
    whereItAppears: stringSchema,
    relevantFiles: stringArraySchema,
    codeSnippet: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: { path: stringSchema, code: stringSchema },
          required: ["path", "code"],
        },
        { type: "null" },
      ],
    },
    beginnerExplanation: stringSchema,
    commonMisconception: stringSchema,
    comprehensionQuestion: stringSchema,
  },
  required: [
    "name",
    "whatIsIt",
    "whyDoesItExist",
    "whyThisRepoUsesIt",
    "whereItAppears",
    "relevantFiles",
    "codeSnippet",
    "beginnerExplanation",
    "commonMisconception",
    "comprehensionQuestion",
  ],
} as const;
