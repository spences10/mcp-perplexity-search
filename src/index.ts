#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ErrorCode,
	ListResourcesRequestSchema,
	ListResourceTemplatesRequestSchema,
	ListToolsRequestSchema,
	McpError,
	ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

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
								model: {
									type: 'string',
									enum: [
										'sonar-small-chat',
										'sonar-small-online',
										'sonar-medium-chat',
										'sonar-medium-online',
									],
									default: 'sonar-medium-chat',
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
					model = 'sonar-medium-chat',
					temperature = 0.7,
					max_tokens = 1024,
				} = request.params.arguments as {
					messages: Array<{ role: string; content: string }>;
					model?: string;
					temperature?: number;
					max_tokens?: number;
				};

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
								messages,
								temperature,
								max_tokens,
							}),
						},
					);

					if (!response.ok) {
						throw new Error(
							`Perplexity API error: ${response.statusText}`,
						);
					}

					const data: PerplexityResponse = await response.json();

					return {
						content: [
							{
								type: 'text',
								text: data.choices[0].message.content,
							},
						],
					};
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