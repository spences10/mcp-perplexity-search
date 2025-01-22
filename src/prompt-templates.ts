/**
 * Predefined prompt templates for common use cases.
 * Each template defines:
 * - system: The system message that sets the assistant's role and behavior
 * - format: The preferred output format (text, markdown, json)
 * - include_sources: Whether to include source URLs in responses
 */
export const PROMPT_TEMPLATES = {
	technical_docs: {
		system:
			'You are a technical documentation assistant. Provide clear, accurate, and well-structured information with code examples where relevant.',
		format: 'markdown' as const,
		include_sources: true,
		description:
			'Technical documentation with code examples and source references',
	},
	security_practices: {
		system:
			'You are a security expert. Provide detailed security best practices, implementation guidelines, and potential vulnerability mitigations.',
		format: 'markdown' as const,
		include_sources: true,
		description:
			'Security best practices and implementation guidelines with references',
	},
	code_review: {
		system:
			'You are a code review assistant. Analyze code for best practices, potential issues, and suggest improvements.',
		format: 'markdown' as const,
		include_sources: false,
		description:
			'Code analysis focusing on best practices and improvements',
	},
	api_docs: {
		system:
			'You are an API documentation assistant. Provide clear explanations of API endpoints, parameters, and usage examples.',
		format: 'json' as const,
		include_sources: true,
		description:
			'API documentation in structured JSON format with examples',
	},
} as const;

export type PromptTemplate = keyof typeof PROMPT_TEMPLATES;

/**
 * Interface for custom prompt templates.
 * Consumers can provide their own templates following this structure.
 */
export interface CustomPromptTemplate {
	system: string;
	format: 'text' | 'markdown' | 'json';
	include_sources: boolean;
	description: string;
}
