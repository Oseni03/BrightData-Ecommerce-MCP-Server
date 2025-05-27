import * as cheerio from "cheerio";
export class ScraperService {
    parseProductDetails(html, platform, url) {
        const $ = cheerio.load(html);
        const baseUrl = new URL(url).origin;
        switch (platform) {
            case "amazon":
                return this.parseAmazonProduct($, baseUrl);
            case "bestbuy":
                return this.parseBestBuyProduct($, baseUrl);
            case "ebay":
                return this.parseEbayProduct($, baseUrl);
            case "etsy":
                return this.parseEtsyProduct($, baseUrl);
            case "homedepot":
                return this.parseHomeDepotProduct($, baseUrl);
            case "walmart":
                return this.parseWalmartProduct($, baseUrl);
            case "zara":
                return this.parseZaraProduct($, baseUrl);
            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }
    }
    parseSearchResults(html, platform, baseUrl) {
        const $ = cheerio.load(html);
        switch (platform) {
            case "amazon":
                return this.parseAmazonSearch($, baseUrl);
            case "bestbuy":
                return this.parseBestBuySearch($, baseUrl);
            case "ebay":
                return this.parseEbaySearch($, baseUrl);
            case "etsy":
                return this.parseEtsySearch($, baseUrl);
            case "homedepot":
                return this.parseHomeDepotSearch($, baseUrl);
            case "walmart":
                return this.parseWalmartSearch($, baseUrl);
            case "zara":
                return this.parseZaraSearch($, baseUrl);
            default:
                return [];
        }
    }
    parseAmazonProduct($, baseUrl) {
        const name = $("#productTitle").text().trim();
        const priceWhole = $("#priceblock_ourprice, #price_inside_buybox")
            .text()
            .trim()
            .replace(/[^0-9.]/g, "");
        const description = $("#feature-bullets, #productDescription")
            .text()
            .trim();
        const brand = $("#bylineInfo").text().trim();
        const rating = parseFloat($("#averageCustomerReviews .a-icon-alt").text());
        const availability = $("#availability").text().trim();
        const seller = $("#merchant-info").text().trim();
        const image = $("#landingImage").attr("src");
        const specifications = {};
        $("#productDetails_techSpec_section_1 tr").each((_, elem) => {
            const label = $(elem).find("th").text().trim();
            const value = $(elem).find("td").text().trim();
            if (label && value) {
                specifications[label] = value;
            }
        });
        const variants = [];
        $("#variation_color_name .swatches li").each((_, elem) => {
            const variant = {
                available: !$(elem).hasClass("swatchUnavailable"),
                name: $(elem).attr("title") || "",
                price: parseFloat($(elem)
                    .find(".a-color-price")
                    .text()
                    .replace(/[^0-9.]/g, "")),
            };
            if (variant.name) {
                variants.push(variant);
            }
        });
        return {
            availability,
            brand,
            currency: "USD",
            description,
            image,
            name,
            platform: "amazon",
            price: parseFloat(priceWhole),
            rating,
            seller,
            specifications,
            url: baseUrl,
            variants,
        };
    }
    parseAmazonSearch($, baseUrl) {
        const products = [];
        $(".s-result-item[data-asin]").each((_, element) => {
            const $el = $(element);
            const name = $el.find("h2 span").text().trim();
            const priceWhole = $el.find(".a-price-whole").first().text().trim();
            const priceFraction = $el
                .find(".a-price-fraction")
                .first()
                .text()
                .trim();
            const rating = parseFloat($el.find(".a-icon-star-small .a-icon-alt").first().text());
            const reviews = parseInt($el
                .find(".a-size-base.s-underline-text")
                .first()
                .text()
                .replace(/[^0-9]/g, ""));
            const href = $el.find("h2 a").attr("href");
            const url = href
                ? href.startsWith("http")
                    ? href
                    : baseUrl + href
                : "";
            const image = $el.find("img.s-image").attr("src");
            if (name && (priceWhole || priceFraction) && url) {
                products.push({
                    currency: "USD",
                    image,
                    name,
                    platform: "amazon",
                    price: parseFloat(`${priceWhole}.${priceFraction}`),
                    rating,
                    reviews,
                    url,
                });
            }
        });
        return products;
    }
    parseBestBuyProduct($, baseUrl) {
        const name = $(".sku-title h1").text().trim();
        const priceText = $(".priceView-customer-price span")
            .first()
            .text()
            .replace(/[^0-9.]/g, "");
        const description = $(".product-description").text().trim();
        const brand = $(".product-data-value").first().text().trim();
        const availability = $(".fulfillment-add-to-cart-button").text().trim();
        const image = $(".primary-image").attr("src");
        const specifications = {};
        $(".product-data-item").each((_, elem) => {
            const label = $(elem).find(".product-data-key").text().trim();
            const value = $(elem).find(".product-data-value").text().trim();
            if (label && value) {
                specifications[label] = value;
            }
        });
        return {
            availability,
            brand,
            currency: "USD",
            description,
            image,
            name,
            platform: "bestbuy",
            price: parseFloat(priceText),
            specifications,
            url: baseUrl,
        };
    }
    parseBestBuySearch($, baseUrl) {
        const products = [];
        $(".sku-item").each((_, element) => {
            const $el = $(element);
            const name = $el.find(".sku-header").text().trim();
            const priceText = $el
                .find(".priceView-customer-price span")
                .first()
                .text()
                .replace("$", "")
                .replace(",", "");
            const href = $el.find(".sku-header a").attr("href");
            const url = href
                ? href.startsWith("http")
                    ? href
                    : `${baseUrl}${href}`
                : "";
            const image = $el.find("img.product-image").attr("src");
            if (name && priceText && url) {
                products.push({
                    currency: "USD",
                    image,
                    name,
                    platform: "bestbuy",
                    price: parseFloat(priceText),
                    url,
                });
            }
        });
        return products;
    }
    parseEbayProduct($, baseUrl) {
        const name = $("#itemTitle").text().replace("Details about", "").trim();
        const priceText = $("#prcIsum")
            .text()
            .trim()
            .replace(/[^0-9.]/g, "");
        const description = $("#ds_div").text().trim();
        const seller = $(".mbg-nw").text().trim();
        const availability = $("#qtySubTxt").text().trim();
        const image = $("#icImg").attr("src");
        const condition = $("#vi-itm-cond").text().trim();
        const specifications = {};
        $(".itemAttr table tr").each((_, elem) => {
            const label = $(elem).find("th").text().trim();
            const value = $(elem).find("td").text().trim();
            if (label && value) {
                specifications[label] = value;
            }
        });
        return {
            availability,
            currency: "USD",
            description,
            image,
            name,
            platform: "ebay",
            price: parseFloat(priceText),
            seller,
            specifications: {
                ...specifications,
                condition,
            },
            url: baseUrl,
        };
    }
    parseEbaySearch($, baseUrl) {
        const products = [];
        $(".s-item").each((_, element) => {
            const $el = $(element);
            const name = $el.find(".s-item__title").text().trim();
            const priceText = $el
                .find(".s-item__price")
                .text()
                .trim()
                .replace("$", "")
                .replace(",", "");
            const href = $el.find(".s-item__link").attr("href");
            const url = href
                ? href.startsWith("http")
                    ? href
                    : `${baseUrl}${href}`
                : "";
            const image = $el.find(".s-item__image-img").attr("src");
            if (name && priceText && url) {
                products.push({
                    currency: "USD",
                    image,
                    name,
                    platform: "ebay",
                    price: parseFloat(priceText),
                    url,
                });
            }
        });
        return products;
    }
    parseEtsyProduct($, baseUrl) {
        const name = $(".wt-text-body-01").first().text().trim();
        const priceText = $(".wt-text-title-03")
            .first()
            .text()
            .replace(/[^0-9.]/g, "");
        const description = $("#product-description-content").text().trim();
        const seller = $(".shop-name-and-title-container").text().trim();
        const image = $(".carousel-image").first().attr("src");
        const specifications = {};
        $(".wt-grid__item-xs-12").each((_, elem) => {
            const label = $(elem).find(".wt-text-caption").text().trim();
            const value = $(elem).find(".wt-text-body-01").text().trim();
            if (label && value) {
                specifications[label] = value;
            }
        });
        return {
            currency: "USD",
            description,
            image,
            name,
            platform: "etsy",
            price: parseFloat(priceText),
            seller,
            specifications,
            url: baseUrl,
        };
    }
    parseEtsySearch($, baseUrl) {
        const products = [];
        $(".v2-listing-card").each((_, element) => {
            const $el = $(element);
            const name = $el.find(".v2-listing-card__title").text().trim();
            const priceText = $el
                .find(".currency-value")
                .first()
                .text()
                .replace(",", "");
            const href = $el.find(".listing-link").attr("href");
            const url = href
                ? href.startsWith("http")
                    ? href
                    : `${baseUrl}${href}`
                : "";
            const image = $el.find("img.main-image").attr("src");
            if (name && priceText && url) {
                products.push({
                    currency: "USD",
                    image,
                    name,
                    platform: "etsy",
                    price: parseFloat(priceText),
                    url,
                });
            }
        });
        return products;
    }
    parseHomeDepotProduct($, baseUrl) {
        const name = $(".product-title__title").text().trim();
        const priceText = $(".price-format__main-price")
            .text()
            .replace(/[^0-9.]/g, "");
        const description = $(".product-description").text().trim();
        const brand = $(".product-details__brand-name").text().trim();
        const availability = $(".product-availability").text().trim();
        const image = $(".highlight-image").attr("src");
        const specifications = {};
        $(".specifications__list li").each((_, elem) => {
            const label = $(elem).find(".specifications__name").text().trim();
            const value = $(elem).find(".specifications__value").text().trim();
            if (label && value) {
                specifications[label] = value;
            }
        });
        return {
            availability,
            brand,
            currency: "USD",
            description,
            image,
            name,
            platform: "homedepot",
            price: parseFloat(priceText),
            specifications,
            url: baseUrl,
        };
    }
    parseHomeDepotSearch($, baseUrl) {
        const products = [];
        $(".product-pod").each((_, element) => {
            const $el = $(element);
            const name = $el.find(".product-pod--title").text().trim();
            const priceText = $el
                .find(".price__dollars")
                .text()
                .replace("$", "")
                .replace(",", "");
            const href = $el.find(".product-pod--link").attr("href");
            const url = href
                ? href.startsWith("http")
                    ? href
                    : `${baseUrl}${href}`
                : "";
            const image = $el.find(".product-pod--photo img").attr("src");
            if (name && priceText && url) {
                products.push({
                    currency: "USD",
                    image,
                    name,
                    platform: "homedepot",
                    price: parseFloat(priceText),
                    url,
                });
            }
        });
        return products;
    }
    parseWalmartProduct($, baseUrl) {
        const name = $('[data-testid="product-title"]').text().trim();
        const priceText = $('[data-testid="price-value"]')
            .text()
            .trim()
            .replace(/[^0-9.]/g, "");
        const description = $(".about-product").text().trim();
        const availability = $(".prod-ProductOffer-oosMsg").text().trim();
        const seller = $(".seller-name").text().trim();
        const image = $('[data-testid="hero-image"]').attr("src");
        const specifications = {};
        $(".specification-table td").each((_, elem) => {
            const label = $(elem).find(".specification-label").text().trim();
            const value = $(elem).find(".specification-value").text().trim();
            if (label && value) {
                specifications[label] = value;
            }
        });
        return {
            availability,
            currency: "USD",
            description,
            image,
            name,
            platform: "walmart",
            price: parseFloat(priceText),
            seller,
            specifications,
            url: baseUrl,
        };
    }
    parseWalmartSearch($, baseUrl) {
        const products = [];
        $("[data-item-id]").each((_, element) => {
            const $el = $(element);
            const name = $el
                .find('[data-automation-id="product-title"]')
                .text()
                .trim();
            const priceText = $el
                .find('[data-automation-id="product-price"]')
                .text()
                .replace("$", "")
                .replace(",", "");
            const url = baseUrl + $el.find("a").attr("href");
            const image = $el.find("img").attr("src");
            if (name && priceText) {
                products.push({
                    currency: "USD",
                    image,
                    name,
                    platform: "walmart",
                    price: parseFloat(priceText),
                    url,
                });
            }
        });
        return products;
    }
    parseZaraProduct($, baseUrl) {
        const name = $(".product-detail-info__header h1").text().trim();
        const priceText = $(".price__amount")
            .text()
            .replace(/[^0-9.]/g, "");
        const description = $(".product-detail-description").text().trim();
        const availability = $(".product-detail-size-info").text().trim();
        const image = $(".product-detail-images img").first().attr("src");
        const specifications = {};
        $(".product-detail-info__content").each((_, elem) => {
            const label = $(elem)
                .find(".product-detail-info__title")
                .text()
                .trim();
            const value = $(elem)
                .find(".product-detail-info__content")
                .text()
                .trim();
            if (label && value) {
                specifications[label] = value;
            }
        });
        const variants = [];
        $(".size-selector__size-list button").each((_, elem) => {
            variants.push({
                available: !$(elem).hasClass("is-disabled"),
                name: $(elem).text().trim(),
            });
        });
        return {
            availability,
            currency: "USD",
            description,
            image,
            name,
            platform: "zara",
            price: parseFloat(priceText),
            specifications,
            url: baseUrl,
            variants,
        };
    }
    parseZaraSearch($, baseUrl) {
        const products = [];
        $(".product-grid-product").each((_, element) => {
            const $el = $(element);
            const name = $el
                .find(".product-grid-product-info__name")
                .text()
                .trim();
            const priceText = $el
                .find(".price-current__amount")
                .text()
                .replace("$", "")
                .replace(",", "");
            const url = baseUrl + $el.find("a").attr("href");
            const image = $el.find("img").attr("src");
            if (name && priceText) {
                products.push({
                    currency: "USD",
                    image,
                    name,
                    platform: "zara",
                    price: parseFloat(priceText),
                    url,
                });
            }
        });
        return products;
    }
}
