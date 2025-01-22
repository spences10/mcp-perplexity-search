#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ErrorCode,
	ListToolsRequestSchema,
	McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
	PROMPT_TEMPLATES,
	type CustomPromptTemplate,
	type PromptTemplate,
} from './prompt-templates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(
	readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
);
const { name, version } = pkg;

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
if (!PERPLEXITY_API_KEY) {
	throw new Error(
		'PERPLEXITY_API_KEY environment variable is required',
	);
}

interface PerplexityResponse {
	choices: Array<{
		message: {
			role: string;
			content: string;
		};
		finish_reason: string;
	}>;
}

class PerplexityServer {
	private server: Server;

	constructor() {
		this.server = new Server(
			{ name, version },
			{
				capabilities: {
					tools: {},
				},
			},
		);

		this.setupToolHandlers();
	}

	private setupToolHandlers() {
		this.server.setRequestHandler(
			ListToolsRequestSchema,
			async () => ({
				tools: [
					{
						name: 'chat_completion',
						description:
							'Generate chat completions using the Perplexity API',
						inputSchema: {
							type: 'object',
							properties: {
								messages: {
									type: 'array',
									items: {
										type: 'object',
										required: ['role', 'content'],
										properties: {
											role: {
												type: 'string',
												enum: ['system', 'user', 'assistant'],
											},
											content: {
												type: 'string',
											},
										},
									},
								},
								prompt_template: {
									type: 'string',
									enum: Object.keys(PROMPT_TEMPLATES),
									description:
										'Predefined prompt template to use for common use cases. Available templates:\n' +
										Object.entries(PROMPT_TEMPLATES)
											.map(
												([key, value]) =>
													`- ${key}: ${value.description}`,
											)
											.join('\n'),
								},
								custom_template: {
									type: 'object',
									description:
										'Custom prompt template. If provided, overrides prompt_template.',
									properties: {
										system: {
											type: 'string',
											description:
												"System message that sets the assistant's role and behavior",
										},
										format: {
											type: 'string',
											enum: ['text', 'markdown', 'json'],
											description: 'Response format',
										},
										include_sources: {
											type: 'boolean',
											description:
												'Whether to include source URLs in responses',
										},
									},
									required: ['system'],
								},
								format: {
									type: 'string',
									enum: ['text', 'markdown', 'json'],
									description:
										'Response format. Use json for structured data, markdown for formatted text with code blocks. Overrides template format if provided.',
									default: 'text',
								},
								include_sources: {
									type: 'boolean',
									description:
										'Include source URLs in the response. Overrides template setting if provided.',
									default: false,
								},
								model: {
									type: 'string',
									enum: [
										'sonar-pro',
										'sonar',
										'llama-3.1-sonar-small-128k-online',
										'llama-3.1-sonar-large-128k-online',
										'llama-3.1-sonar-huge-128k-online',
									],
									description:
										'Model to use for completion. Note: llama-3.1 models will be deprecated after 2/22/2025',
									default: 'sonar',
								},
								temperature: {
									type: 'number',
									minimum: 0,
									maximum: 1,
									default: 0.7,
								},
								max_tokens: {
									type: 'number',
									minimum: 1,
									maximum: 4096,
									default: 1024,
								},
							},
							required: ['messages'],
						},
					},
				],
			}),
		);

		this.server.setRequestHandler(
			CallToolRequestSchema,
			async (request) => {
				if (request.params.name !== 'chat_completion') {
					throw new McpError(
						ErrorCode.MethodNotFound,
						`Unknown tool: ${request.params.name}`,
					);
				}

				const {
					messages,
					prompt_template,
					custom_template,
					model = 'sonar',
					temperature = 0.7,
					max_tokens = 1024,
					format: user_format,
					include_sources: user_include_sources,
				} = request.params.arguments as {
					messages: Array<{ role: string; content: string }>;
					prompt_template?: PromptTemplate;
					custom_template?: CustomPromptTemplate;
					model?: string;
					temperature?: number;
					max_tokens?: number;
					format?: 'text' | 'markdown' | 'json';
					include_sources?: boolean;
				};

				// Apply template if provided (custom template takes precedence)
				const template =
					custom_template ??
					(prompt_template
						? PROMPT_TEMPLATES[prompt_template]
						: null);
				const format = user_format ?? template?.format ?? 'text';
				const include_sources =
					user_include_sources ?? template?.include_sources ?? false;

				// Merge template system message with user messages if template is provided
				const final_messages = template
					? [
							{ role: 'system', content: template.system },
							...messages,
					  ]
					: messages;

				try {
					const controller = new AbortController();
					const timeoutId = setTimeout(
						() => controller.abort(),
						30000,
					); // 30 second timeout

					try {
						const response = await fetch(
							'https://api.perplexity.ai/chat/completions',
							{
								method: 'POST',
								headers: {
									'Content-Type': 'application/json',
									Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
								},
								body: JSON.stringify({
									model,
									messages: final_messages,
									temperature,
									max_tokens,
									format,
									include_sources,
								}),
								signal: controller.signal,
							},
						);

						if (!response.ok) {
							const errorData = await response
								.json()
								.catch(() => ({}));
							throw new McpError(
								ErrorCode.InternalError,
								`Perplexity API error: ${response.statusText}${
									errorData.error ? ` - ${errorData.error}` : ''
								}`,
							);
						}

						const data: PerplexityResponse = await response.json();

						if (!data.choices?.[0]?.message) {
							throw new McpError(
								ErrorCode.InternalError,
								'Invalid response format from Perplexity API',
							);
						}

						return {
							content: [
								{
									type: format === 'json' ? 'json' : 'text',
									text: data.choices[0].message.content,
								},
							],
						};
					} finally {
						clearTimeout(timeoutId);
					}
				} catch (error) {
					return {
						content: [
							{
								type: 'text',
								text: `Error generating completion: ${
									error instanceof Error
										? error.message
										: String(error)
								}`,
							},
						],
						isError: true,
					};
				}
			},
		);
	}

	async run() {
		const transport = new StdioServerTransport();
		await this.server.connect(transport);
		console.error('Perplexity MCP server running on stdio');
	}
}

const server = new PerplexityServer();
server.run().catch(console.error);
