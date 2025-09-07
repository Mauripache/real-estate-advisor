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

async function intermediateDecisioning(properties: any[], originalInput: string) {
  function chunk<T>(arr: T[], size: number): T[][] {
    return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
      arr.slice(i * size, i * size + size)
    );
  }

  let currentBatch = properties;

  // reducimos hasta tener 50 o menos
  while (currentBatch.length > 50) {
    const chunks = chunk(currentBatch, 50);

    const results = await Promise.all(
      chunks.map(async (group) => {
        const res = await client.responses.create({
          model: "gpt-4o-mini",
          instructions: intermediateDecisionContext,
          input:
            originalInput +
            "\n\n" +
            group.map((p) => JSON.stringify(p)).join(""),
        });
        return res.output_text;
      })
    );

    currentBatch = results.flatMap((output) => JSON.parse(output));
  }

  return currentBatch;
}

async function fetchPage(pageUrl: string) {
  try {
    const { data: html } = await axios.get(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; scraper/1.0)",
      },
    });
    const $ = cheerio.load(html);
    const rawJson = $("#__NEXT_DATA__").html();
    if (!rawJson) return [];
    const nextData = JSON.parse(rawJson);
    return nextData.props.pageProps.fetchResult.searchFast.data.map(mapProperty);
  } catch (err: any) {
    console.error("Failed fetching:", pageUrl, err.message);
    return [];
  }
}

export async function scrapeAllProperties(url: string) {
  // Primera request para conocer paginatorInfo
  const { data: firstHtml } = await axios.get(url);
  const $first = cheerio.load(firstHtml);

  const rawJson = $first("#__NEXT_DATA__").html();
  if (!rawJson) throw new Error("No __NEXT_DATA__ script found");

  const firstData = JSON.parse(rawJson);
  const paginatorInfo =
    firstData.props.pageProps.fetchResult.searchFast.paginatorInfo;

  const totalPages = paginatorInfo.lastPage;
  console.log("Total pages to scrape:", totalPages);

  const pageUrls = Array.from({ length: totalPages }, (_, i) =>
    i === 0 ? url : `${url}/pagina${i + 1}`
  );

  // Ejecutar de a N páginas por vez
  const CONCURRENCY = 50;
  const properties: any[] = [];

  for (let i = 0; i < pageUrls.length; i += CONCURRENCY) {
    const chunk = pageUrls.slice(i, i + CONCURRENCY);

    const batchResults = await Promise.all(chunk.map(fetchPage));
    properties.push(...batchResults.flat());
  }

  console.log("Finished scraping. Total properties found:", properties.length);
  console.log("Expected properties: " + paginatorInfo.total)
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
  const input = "Dame apartamentos en montevideo en venta con renta de menos de 140000 y mas de 50000 dolares en reducto y aguada";
  const url = await generateLink(input);
  console.log("URL generado:", url);

  const properties = await scrapeAllProperties(url);
  const intermediateRes = await intermediateDecisioning(properties, input);

  const decision = await makeDecision(input, JSON.stringify(intermediateRes));
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
    const properties = await scrapeAllProperties(url);
    const intermediateRes = await intermediateDecisioning(properties, message);
    const decision = await makeDecision(message, JSON.stringify(intermediateRes));

    res.json({ query: message, decision });
  } catch (err) {
    console.error("Error in /api/getAdvice:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(3000);