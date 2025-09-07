import OpenAI from "openai";
import "dotenv/config";
import linkGenerationContext from "./prompts/linkGenerationContext";
import decisionMakingContext from "./prompts/decisionMakingContext";
import * as express from "express";
import * as cors from "cors";
import axios from "axios";
import * as cheerio from "cheerio";
import intermediateDecisionContext from "./prompts/intermediateDecisionContext";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function generateLink(description: string) {
  const response = await client.responses.create({
    model: "gpt-4o-mini",
    instructions: linkGenerationContext,
    input: description
  });

  return response.output_text;
}

function mapProperty(raw: any) {
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description?.replace(/<br\s*\/?>/gi, "\n").trim(),
    link: "https://www.infocasas.com.uy" + raw.link,
    price_usd: raw.price_amount_usd,
    currency: raw.currency,
    bedrooms: raw.bedrooms,
    bathrooms: raw.bathrooms,
    m2Built: raw.m2Built || raw.m2apto || raw.m2,
    garage: raw.hasGarage || raw.garage > 0,
    propertyType: raw.property_type?.name,
    operationType: raw.operation_type?.name,
    neighborhood: raw.locations?.neighbourhood?.[0]?.name || null,
    commonExpenses: raw.commonExpenses?.amount,
    constructionYear: raw.construction_year,
    images: raw.images?.map((img: any) => img.src || img.link || img) || [],
    technicalSheet: Object.fromEntries(
      (raw.technicalSheet || []).map((item: any) => [item.label, item.value])
    ),
    facilities: raw.facilities || [],
  };
}

export async function scrapeAllProperties(url: string, originalInput: string) {
  let hasNextPage = true;
  let properties: any[] = [];
  let nextPage = "";

  while (hasNextPage) {
    const { data: html } = await axios.get(url + nextPage);
    const $ = cheerio.load(html);

    // Extract the raw JSON from the script tag
    const rawJson = $("#__NEXT_DATA__").html();
    if (!rawJson) {
      throw new Error("No __NEXT_DATA__ script found");
    }

    const nextData = JSON.parse(rawJson);
    const pageData =
      nextData.props.pageProps.fetchResult.searchFast.data.map(mapProperty);

    // Only happens if the first page has no results, thus no data
    if (pageData.length === 0) {
      return properties;
    }

    const response = await client.responses.create({
      model: "gpt-4o-mini",
      instructions: intermediateDecisionContext,
      input: originalInput + "\n\n" + JSON.stringify(pageData)
    });

    const intermediateProperties = JSON.parse(response.output_text).map((propId: string) => {
      return pageData.find((p: any) => p.id === propId);
    });

    properties = [...properties, ...intermediateProperties];

    console.log("Scraping page:", url + nextPage);
    console.log(
      `Found ${pageData.length} properties on this page. Total so far: ${properties.length}`
    );

    hasNextPage =
      nextData.props.pageProps.fetchResult.searchFast.paginatorInfo.hasMorePages;
    nextPage =
      "/pagina" +
      (nextData.props.pageProps.fetchResult.searchFast.paginatorInfo
        .currentPage + 1);
  }

  console.log("Finished scraping. Total properties found:", properties.length);
  return properties;
}


async function makeDecision(originalInput: string, properties: string) {
  const response = await client.responses.create({
    model: "gpt-4o-mini",
    instructions: decisionMakingContext,
    input: originalInput + "\n\n" + properties
  });

  return response.output_text;
}

/*async function main() {
  const input = "Dame apartamentos en montevideo en venta con renta de menos de 100000 y mas de 80000 dolares de 1 dormitorio o mas en la blanqueada";
  const url = await generateLink(input);
  console.log("URL generado:", url);

  const properties = await scrapeAllProperties(url, input);
  console.log("Propiedades encontradas:", properties.length);

  const decision = await makeDecision(input, JSON.stringify(properties));
  console.log(decision);
}

main();*/

const app = express();
app.use(cors({
  origin: "https://preview--real-estate-advisor-ui.lovable.app",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
}));
app.use(express.json());

app.post("/api/getAdvice", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Missing 'message' field in body" });
    }

    console.log("User query:", message);

    const url = await generateLink(message);

    const properties = await scrapeAllProperties(url, message);

    const decision = await makeDecision(message, JSON.stringify(properties));

    res.json({ query: message, decision });
  } catch (err) {
    console.error("Error in /api/getAdvice:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(3000);