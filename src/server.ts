import axios from "axios";
import { FastMCP } from "fastmcp";
// import { createRequire } from "node:module";
import { z } from "zod";
import "dotenv/config";

// const require = createRequire(import.meta.url);
// const package_json = require("../package.json");

const api_token = process.env.BRIGHT_DATA_API_TOKEN;
const unlocker_zone = process.env.WEB_UNLOCKER_ZONE || "ecommerce_tracker";

if (!api_token) {
	throw new Error("Cannot run MCP server without BRIGHT_DATA_API_TOKEN env");
}

const api_headers = () => ({
	authorization: `Bearer ${api_token}`,
	"user-agent": `pricebot/1.0.0`,
});

type Platform =
	| "amazon"
	| "bestbuy"
	| "ebay"
	| "etsy"
	| "homedepot"
	| "unknown"
	| "walmart"
	| "zara";

interface ProductData {
	data: unknown;
	method: string;
	platform: Platform;
	url: string;
}

interface ServerTools {
	get_product_details: {
		execute: (args: {
			include_reviews?: boolean;
			url: string;
		}) => Promise<ProductData>;
	};
	search_products: {
		execute: (args: {
			max_results?: number;
			platforms?: Platform[];
			query: string;
		}) => Promise<{ results: ProductData[] }>;
	};
}

interface TrackingInfo {
	first_tracked: string;
	last_updated: string;
	latest_data?: ProductData;
	name: string;
	platform: Platform;
	target_price?: number;
	update_count: number;
	url: string;
}

const server = new FastMCP({
	name: "PriceBot",
	version: "1.0.0",
}) as { tools: ServerTools } & FastMCP;

const debug_stats = {
	tool_calls: {} as Record<string, number>,
	tracked_products: new Map<string, TrackingInfo>(),
};

// Helper function to wrap tool execution with stats tracking
const tool_fn =
	<T extends Record<string, unknown>>(
		name: string,
		fn: (args: T) => Promise<string>
	) =>
	async (args: T) => {
		debug_stats.tool_calls[name] = (debug_stats.tool_calls[name] || 0) + 1;
		return await fn(args);
	};

// Ensure required zones exist
async function ensure_required_zones() {
	try {
		console.error("Checking for required zones...");
		const response = await axios({
			headers: api_headers(),
			method: "GET",
			url: "https://api.brightdata.com/zone/get_active_zones",
		});
		const zones = response.data || [];
		const has_unlocker_zone = zones.some(
			(zone: { name: string }) => zone.name == unlocker_zone
		);
		if (!has_unlocker_zone) {
			console.error(
				`Required zone "${unlocker_zone}" not found, creating it...`
			);
			await axios({
				data: {
					plan: { type: "unblocker" },
					zone: { name: unlocker_zone, type: "unblocker" },
				},
				headers: {
					...api_headers(),
					"Content-Type": "application/json",
				},
				method: "POST",
				url: "https://api.brightdata.com/zone",
			});
			console.error(`Zone "${unlocker_zone}" created successfully`);
		} else {
			console.error(`Required zone "${unlocker_zone}" already exists`);
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} catch (e: any) {
		console.error(
			"Error checking/creating zones:",
			e.response?.data || e.message
		);
	}
}

await ensure_required_zones();

// Universal product search across multiple platforms
server.addTool({
	description:
		"Search for products across multiple e-commerce platforms (Amazon, eBay, Walmart, etc.). Returns structured product data including prices, ratings, and availability.",
	execute: tool_fn<{ platforms: Platform[]; query: string }>(
		"search_products",
		async ({ platforms, query }) => {
			const results: Array<{
				data?: unknown;
				error?: string;
				platform: Platform;
				search_url: string;
			}> = [];

			for (const platform of platforms) {
				try {
					let search_url = "";
					switch (platform) {
						case "amazon":
							search_url = `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
							break;
						case "bestbuy":
							search_url = `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(query)}`;
							break;
						case "ebay":
							search_url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`;
							break;
						case "etsy":
							search_url = `https://www.etsy.com/search?q=${encodeURIComponent(query)}`;
							break;
						case "homedepot":
							search_url = `https://www.homedepot.com/search?q=${encodeURIComponent(query)}`;
							break;
						case "walmart":
							search_url = `https://www.walmart.com/search?q=${encodeURIComponent(query)}`;
							break;
						case "zara":
							search_url = `https://www.zara.com/us/en/search?q=${encodeURIComponent(query)}`;
							break;
					}

					const response = await axios({
						data: {
							data_format: "markdown",
							format: "raw",
							url: search_url,
							zone: unlocker_zone,
						},
						headers: api_headers(),
						method: "POST",
						responseType: "text",
						url: "https://api.brightdata.com/request",
					});

					results.push({
						data: response.data,
						platform,
						search_url,
					});
				} catch (e: unknown) {
					results.push({
						error:
							e instanceof Error
								? e.message
								: "An unknown error occurred",
						platform,
						search_url: "",
					});
				}
			}

			return JSON.stringify(
				{
					platforms_searched: platforms,
					query,
					results,
				},
				null,
				2
			);
		}
	),
	name: "search_products",
	parameters: z.object({
		max_results: z
			.number()
			.min(1)
			.max(50)
			.optional()
			.default(10)
			.describe("Maximum number of results per platform"),
		platforms: z
			.array(z.enum(["amazon", "ebay", "walmart", "etsy", "bestbuy"]))
			.optional()
			.default(["amazon", "ebay", "walmart"])
			.describe("E-commerce platforms to search"),
		query: z.string().describe("Product search query"),
	}),
});

// Get detailed product information
server.addTool({
	description:
		"Get detailed information about a specific product from its URL. Supports Amazon, eBay, Walmart, Etsy, BestBuy, Home Depot, and Zara.",
	execute: tool_fn<{ url: string }>(
		"get_product_details",
		async ({ url }) => {
			const platform = detect_platform(url);
			const dataset_id = get_dataset_id(platform);

			if (!dataset_id) {
				// Fallback to general scraping
				const response = await axios({
					data: {
						data_format: "markdown",
						format: "raw",
						url,
						zone: unlocker_zone,
					},
					headers: api_headers(),
					method: "POST",
					responseType: "text",
					url: "https://api.brightdata.com/request",
				});
				return JSON.stringify(
					{
						data: response.data,
						method: "scraping",
						platform,
						url,
					},
					null,
					2
				);
			}

			// Use structured dataset
			const trigger_response = await axios({
				data: [{ url }],
				headers: api_headers(),
				method: "POST",
				params: { dataset_id, include_errors: true },
				url: "https://api.brightdata.com/datasets/v3/trigger",
			});

			if (!trigger_response.data?.snapshot_id) {
				throw new Error("Failed to trigger dataset collection");
			}

			const snapshot_id = trigger_response.data.snapshot_id;

			// Poll for results
			const max_attempts = 30;
			for (let i = 0; i < max_attempts; i++) {
				await new Promise((resolve) => setTimeout(resolve, 2000));

				const status_response = await axios({
					headers: api_headers(),
					method: "GET",
					url: `https://api.brightdata.com/datasets/v3/progress/${snapshot_id}`,
				});

				if (status_response.data.status === "running") continue;

				if (status_response.data.status === "failed") {
					throw new Error("Dataset collection failed");
				}

				// Get results
				const results_response = await axios({
					headers: api_headers(),
					method: "GET",
					url: `https://api.brightdata.com/datasets/v3/snapshot/${snapshot_id}`,
				});

				const product_data = {
					data: results_response.data,
					method: "structured_dataset",
					platform,
					url,
				};

				// Add to tracking if not already tracked
				if (!debug_stats.tracked_products.has(url)) {
					debug_stats.tracked_products.set(url, {
						first_tracked: new Date().toISOString(),
						last_updated: new Date().toISOString(),
						name: "",
						platform,
						update_count: 1,
						url,
					});
				}

				return JSON.stringify(product_data, null, 2);
			}

			throw new Error("Timeout waiting for dataset results");
		}
	),
	name: "get_product_details",
	parameters: z.object({
		url: z.string().url().describe("Product URL"),
	}),
});

// Price comparison across platforms
server.addTool({
	description:
		"Compare prices for a product across multiple e-commerce platforms. Provide either a search query or specific product URLs.",
	execute: tool_fn<{
		platforms: Platform[];
		query?: string;
		urls?: string[];
	}>("compare_prices", async ({ platforms, query, urls }) => {
		let comparison_results = [];

		if (urls && urls.length > 0) {
			// Compare specific URLs
			for (const url of urls) {
				try {
					const product_details =
						await server.tools.get_product_details.execute({ url });
					comparison_results.push(product_details);
				} catch (e: unknown) {
					comparison_results.push({
						error: (e as Error).message,
						url,
					});
				}
			}
		} else if (query) {
			// Search and compare
			const search_results = await server.tools.search_products.execute({
				max_results: 5,
				platforms,
				query,
			});
			comparison_results = search_results.results;
		} else {
			throw new Error("Either query or urls must be provided");
		}

		return JSON.stringify(
			{
				query: query || null,
				results: comparison_results,
				timestamp: new Date().toISOString(),
				type: urls ? "url_comparison" : "search_comparison",
			},
			null,
			2
		);
	}),
	name: "compare_prices",
	parameters: z.object({
		platforms: z
			.array(z.enum(["amazon", "ebay", "walmart", "etsy", "bestbuy"]))
			.optional()
			.default(["amazon", "ebay", "walmart"])
			.describe("Platforms to compare (only used with query)"),
		query: z.string().optional().describe("Product search query"),
		urls: z
			.array(z.string().url())
			.optional()
			.describe("Specific product URLs to compare"),
	}),
});

// Track product for price changes
server.addTool({
	description:
		"Add a product to tracking list for price monitoring and updates.",
	execute: tool_fn<{ name?: string; target_price?: number; url: string }>(
		"track_product",
		async ({ name, target_price, url }) => {
			const existing = debug_stats.tracked_products.get(url);
			const platform = detect_platform(url);

			const tracking_info = {
				first_tracked:
					existing?.first_tracked || new Date().toISOString(),
				last_updated: new Date().toISOString(),
				name: name || `Product from ${platform}`,
				platform,
				target_price,
				update_count: (existing?.update_count || 0) + 1,
				url,
			};

			debug_stats.tracked_products.set(url, tracking_info);

			return JSON.stringify(
				{
					message: "Product added to tracking list",
					total_tracked: debug_stats.tracked_products.size,
					tracking_info,
				},
				null,
				2
			);
		}
	),
	name: "track_product",
	parameters: z.object({
		name: z.string().optional().describe("Custom name for the product"),
		target_price: z.number().optional().describe("Target price for alerts"),
		url: z.string().url().describe("Product URL to track"),
	}),
});

// Get tracking status
server.addTool({
	description: "Get list of all tracked products and their current status.",
	execute: tool_fn<{ url: string }>("get_tracked_products", async () => {
		const tracked = Array.from(debug_stats.tracked_products.values());

		return JSON.stringify(
			{
				last_check: new Date().toISOString(),
				products: tracked,
				total_tracked: tracked.length,
			},
			null,
			2
		);
	}),
	name: "get_tracked_products",
	parameters: z.object({
		url: z.string().url().describe("Product URL"),
	}),
});

// Update prices for tracked products
server.addTool({
	description: "Update price information for all tracked products.",
	execute: tool_fn<{ url?: string }>(
		"update_tracked_prices",
		async ({ url }) => {
			const urls_to_update = url
				? [url]
				: Array.from(debug_stats.tracked_products.keys());
			const updates = [];

			for (const product_url of urls_to_update) {
				try {
					const current_data =
						await server.tools.get_product_details.execute({
							url: product_url,
						});
					const tracking_info =
						debug_stats.tracked_products.get(product_url);

					if (tracking_info) {
						tracking_info.last_updated = new Date().toISOString();
						tracking_info.update_count += 1;
						tracking_info.latest_data = current_data;
						debug_stats.tracked_products.set(
							product_url,
							tracking_info
						);
					}

					updates.push({
						data: current_data,
						status: "updated",
						url: product_url,
					});
				} catch (e: unknown) {
					updates.push({
						error: (e as Error).message,
						status: "error",
						url: product_url,
					});
				}
			}

			return JSON.stringify(
				{
					timestamp: new Date().toISOString(),
					updated_products: updates.length,
					updates,
				},
				null,
				2
			);
		}
	),
	name: "update_tracked_prices",
	parameters: z.object({
		url: z
			.string()
			.url()
			.optional()
			.describe(
				"Specific product URL to update (if not provided, updates all)"
			),
	}),
});

// Session statistics
server.addTool({
	description:
		"Get statistics about current session usage and tracked products.",
	execute: tool_fn<{ url: string }>("session_stats", async () => {
		const used_tools = Object.entries(debug_stats.tool_calls);
		const lines = ["E-commerce Tracker Session Stats:", ""];

		lines.push("Tool Usage:");
		for (const [name, calls] of used_tools) {
			lines.push(`- ${name}: ${calls} calls`);
		}

		lines.push(
			"",
			`Tracked Products: ${debug_stats.tracked_products.size}`
		);

		if (debug_stats.tracked_products.size > 0) {
			lines.push("", "Tracked Products:");
			for (const [url, info] of debug_stats.tracked_products) {
				lines.push(`- ${info.name} (${info.platform})`);
				lines.push(`  URL: ${url}`);
				lines.push(`  Updates: ${info.update_count}`);
				if (info.target_price) {
					lines.push(`  Target Price: $${info.target_price}`);
				}
			}
		}

		return lines.join("\n");
	}),
	name: "session_stats",
	parameters: z.object({
		url: z.string().url().describe("Product URL"),
	}),
});

// Helper functions
function detect_platform(url: string): Platform {
	if (url.includes("amazon.")) return "amazon";
	if (url.includes("ebay.")) return "ebay";
	if (url.includes("walmart.")) return "walmart";
	if (url.includes("etsy.")) return "etsy";
	if (url.includes("bestbuy.")) return "bestbuy";
	if (url.includes("homedepot.")) return "homedepot";
	if (url.includes("zara.")) return "zara";
	return "unknown";
}

function get_dataset_id(platform: Platform): string | undefined {
	const dataset_map: Record<Platform, string> = {
		amazon: "gd_l7q7dkf244hwjntr0",
		bestbuy: "gd_ltre1jqe1jfr7cccf",
		ebay: "gd_ltr9mjt81n0zzdk1fb",
		etsy: "gd_ltppk0jdv1jqz25mz",
		homedepot: "gd_lmusivh019i7g97q2n",
		unknown: "",
		walmart: "gd_l95fol7l1ru6rlo116",
		zara: "gd_lct4vafw1tgx27d4o0",
	};
	return dataset_map[platform] || undefined;
}

server.start({
	transportType: "stdio",
});
