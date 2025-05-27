import axios from "axios";
import { FastMCP } from "fastmcp";
// import { createRequire } from "node:module";
import { z } from "zod";
import "dotenv/config";
import { ProductService } from "./services/product-service.js";
import { ScraperService } from "./services/scraper-service.js";
// Initialize services
const productService = new ProductService();
const scraperService = new ScraperService();
const api_token = process.env.BRIGHT_DATA_API_TOKEN;
const unlocker_zone = process.env.WEB_UNLOCKER_ZONE || "ecommerce_tracker";
if (!api_token) {
    throw new Error("Cannot run MCP server without BRIGHT_DATA_API_TOKEN env");
}
const api_headers = () => ({
    authorization: `Bearer ${api_token}`,
    "user-agent": `pricemorphe/1.0.0`,
});
const server = new FastMCP({
    name: "PriceMorphe",
    version: "1.0.0",
});
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
        const has_unlocker_zone = zones.some((zone) => zone.name == unlocker_zone);
        if (!has_unlocker_zone) {
            console.error(`Required zone "${unlocker_zone}" not found, creating it...`);
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
        }
        else {
            console.error(`Required zone "${unlocker_zone}" already exists`);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }
    catch (e) {
        console.error("Error checking/creating zones:", e.response?.data || e.message);
    }
}
await ensure_required_zones();
// Universal product search across multiple platforms
server.addTool({
    description: "Search for products across multiple e-commerce platforms (Amazon, eBay, Walmart, etc.). Returns structured product data including prices, ratings, and availability.",
    execute: async ({ platforms, query }) => {
        const results = [];
        for (const platform of platforms) {
            try {
                let search_url = "";
                switch (platform) {
                    case "amazon":
                        search_url = `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
                        break;
                    case "bestbuy":
                        search_url = `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(query)}&intl=nosplash`;
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
                        format: "raw",
                        url: search_url,
                        zone: unlocker_zone,
                    },
                    headers: api_headers(),
                    method: "POST",
                    responseType: "text",
                    url: "https://api.brightdata.com/request",
                });
                const baseUrl = new URL(search_url).origin;
                const parsedProducts = scraperService.parseSearchResults(response.data, platform, baseUrl);
                results.push({
                    data: parsedProducts,
                    platform,
                    search_url,
                });
            }
            catch (e) {
                results.push({
                    error: e instanceof Error
                        ? e.message
                        : "An unknown error occurred",
                    platform,
                    search_url: "",
                });
            }
        }
        return JSON.stringify({
            platforms_searched: platforms,
            query,
            results,
        }, null, 2);
    },
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
            .array(z.enum([
            "amazon",
            "ebay",
            "walmart",
            "etsy",
            "bestbuy",
            "homedepot",
            "zara",
        ]))
            .optional()
            .default(["amazon", "ebay", "walmart"])
            .describe("E-commerce platforms to search"),
        query: z.string().describe("Product search query"),
    }),
});
// Get detailed product information
server.addTool({
    description: "Get detailed information about a specific product from its URL. Supports Amazon, eBay, Walmart, Etsy, BestBuy, Home Depot, and Zara.",
    execute: async ({ url }) => {
        const platform = detect_platform(url);
        const dataset_id = get_dataset_id(platform);
        if (!dataset_id) {
            // Fallback to general scraping
            const response = await axios({
                data: {
                    format: "raw",
                    url,
                    zone: unlocker_zone,
                },
                headers: api_headers(),
                method: "POST",
                responseType: "text",
                url: "https://api.brightdata.com/request",
            });
            const baseUrl = new URL(url).origin;
            const parsedProduct = scraperService.parseProductDetails(response.data, platform, baseUrl);
            return JSON.stringify({
                data: parsedProduct,
                method: "scraping",
                platform,
                url,
            }, null, 2);
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
            if (status_response.data.status === "running")
                continue;
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
            return JSON.stringify(product_data, null, 2);
        }
        throw new Error("Timeout waiting for dataset results");
    },
    name: "get_product_details",
    parameters: z.object({
        url: z.string().url().describe("Product URL"),
    }),
});
// Price comparison across platforms
server.addTool({
    description: "Compare prices for a product across multiple e-commerce platforms. Provide either a search query or specific product URLs.",
    execute: async ({ platforms, query, urls }) => {
        let comparison_results = [];
        if (urls && urls.length > 0) {
            // Compare specific URLs
            for (const url of urls) {
                try {
                    const product_details = await server.tools.get_product_details.execute({ url });
                    comparison_results.push(product_details);
                }
                catch (e) {
                    console.log(e.message);
                }
            }
        }
        else if (query) {
            // Search and compare
            const search_results = await server.tools.search_products.execute({
                // max_results: 5,
                platforms,
                query,
            });
            comparison_results = search_results.results;
        }
        else {
            throw new Error("Either query or urls must be provided");
        }
        return JSON.stringify({
            query: query || null,
            results: comparison_results,
            timestamp: new Date().toISOString(),
            type: urls ? "url_comparison" : "search_comparison",
        }, null, 2);
    },
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
// Update prices for tracked products
server.addTool({
    description: "Update price information for all tracked products.",
    execute: async ({ urls }) => {
        const updates = [];
        for (const product_url of urls) {
            try {
                const current_data = await server.tools.get_product_details.execute({
                    url: product_url,
                });
                updates.push({
                    data: current_data,
                    status: "updated",
                    url: product_url,
                });
            }
            catch (e) {
                updates.push({
                    error: e.message,
                    status: "error",
                    url: product_url,
                });
            }
        }
        return JSON.stringify({
            timestamp: new Date().toISOString(),
            updated_products: updates.length,
            updates,
        }, null, 2);
    },
    name: "get_price_update",
    parameters: z.object({
        urls: z
            .array(z.string().url())
            .optional()
            .default([])
            .describe("Specific product URLs to update"),
    }),
});
// Product Management Tools
server.addTool({
    description: "Get all products tracked by a specific user",
    execute: async ({ include_price_history, userId }) => {
        const products = await productService.getUserTrackedProducts(userId, include_price_history);
        return JSON.stringify(products, null, 2);
    },
    name: "get_user_tracked_products",
    parameters: z.object({
        include_price_history: z.boolean().optional().default(false),
        userId: z.string(),
    }),
});
server.addTool({
    description: "Track a new product for a user. All prices are stored in cents/pennies to avoid floating point issues.",
    execute: async ({ name, platform, target_price, tracking_type, url, userId, }) => {
        const product = await productService.trackProduct(userId, {
            name,
            platform,
            target_price: target_price ? Math.round(target_price * 100) : null, // Convert to cents/pennies
            tracking_type,
            url,
        });
        return JSON.stringify(product, null, 2);
    },
    name: "track_product",
    parameters: z.object({
        name: z.string().describe("Product name"),
        platform: z
            .enum([
            "amazon",
            "ebay",
            "walmart",
            "etsy",
            "bestbuy",
            "homedepot",
            "zara",
            "unknown",
        ])
            .describe("The e-commerce platform where the product is listed"),
        target_price: z
            .number()
            .optional()
            .describe("Target price for price alerts (in dollars)"),
        tracking_type: z
            .enum(["price", "stock", "both"])
            .default("price")
            .describe("What to track: price changes, stock status, or both"),
        url: z.string().url().describe("Product URL to track"),
        userId: z
            .string()
            .describe("User ID to associate the tracked product with"),
    }),
});
server.addTool({
    description: "Stop tracking a product for a user",
    execute: async ({ productId, userId }) => {
        const result = await productService.untrackProduct(userId, productId);
        return JSON.stringify(result, null, 2);
    },
    name: "untrack_product",
    parameters: z.object({
        productId: z.string(),
        userId: z.string(),
    }),
});
server.addTool({
    description: "Update prices for multiple tracked products",
    execute: async ({ updates }) => {
        const result = await productService.updateAllProducts(updates);
        return JSON.stringify(result, null, 2);
    },
    name: "update_product_prices",
    parameters: z.object({
        updates: z.array(z.object({
            currentPrice: z.number(),
            id: z.string(),
        })),
    }),
});
// Helper functions
function detect_platform(url) {
    if (url.includes("amazon."))
        return "amazon";
    if (url.includes("ebay."))
        return "ebay";
    if (url.includes("walmart."))
        return "walmart";
    if (url.includes("etsy."))
        return "etsy";
    if (url.includes("bestbuy."))
        return "bestbuy";
    if (url.includes("homedepot."))
        return "homedepot";
    if (url.includes("zara."))
        return "zara";
    return "unknown";
}
function get_dataset_id(platform) {
    const dataset_map = {
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
server.start();
