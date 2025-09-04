import OpenAI from "openai";
import "dotenv/config";
import linkGenerationContext from "./prompts/linkGenerationContext";
import puppeteer from "puppeteer";
import decisionMakingContext from "./prompts/decisionMakingContext";

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


async function scrapeAllProperties(startUrl: string, concurrency = 50) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const properties: any[] = [];

  await page.goto(startUrl, { waitUntil: "domcontentloaded"});

  let hasNext = true;

  while (hasNext) {
    console.log("Scraping page:", page.url());

    // Get all property links on this page
    const links: string[] = await page.$$eval('a.lc-cardCover', anchors =>
      anchors.map(a => a.href)
    );

    console.log(`Found ${links.length} properties on this page.`);

    // Scrape each property
    const scrapeDetail = async (link: string) => {
      const detailPage = await browser.newPage();
      await detailPage.goto(link, { waitUntil: "domcontentloaded" });

      // Extract both basic fields and technical sheet rows
      const propertyDetails = await detailPage.evaluate(() => {
        // Basic fields
        const base = {
          title: document.querySelector('.property-title')?.textContent?.trim() ?? null,
          price: document.querySelector('.price')?.textContent?.trim() ?? null,
          location: document.querySelector('.property-location-tag')?.textContent?.trim() ?? null,
          amenities: Array.from(
              document.querySelectorAll('.property-facilities .UY-facility-batch .ant-typography:not(.ant-typography-secondary)')
            ).map(el => el.textContent?.trim()).filter(Boolean),
          description: document.querySelector('.property-description')?.textContent?.trim() ?? null,
          link: window.location.href,
        };

        // Technical sheet
        const sheet: Record<string, string | null> = {};
        document.querySelectorAll('.technical-sheet .ant-row').forEach(row => {
          const label = row.querySelector('.ant-space-item span.ant-typography:not(.ant-typography-secondary)')?.textContent?.trim();
          const value = row.querySelector('strong')?.textContent?.trim() ?? null;
          if (label) {
            sheet[label] = value;
          }
        });

        return { ...base, technicalSheet: sheet };
      });

      await detailPage.close();
      return propertyDetails;
    }

     // Parallelize with concurrency limit
    for (let i = 0; i < links.length; i += concurrency) {
      const chunk = links.slice(i, i + concurrency);
      const results = await Promise.all(chunk.map(scrapeDetail));
      properties.push(...results);
    }

    // Look for the ">" button
    const nextButton = await page.$(
      ".search-results-pagination li:last-child a:not([aria-label])"
    );

    if (nextButton) {
      console.log("Clicking next page...");
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded"}),
        nextButton.click(),
      ]);
    } else {
      console.log("No more pages.");
      hasNext = false;
    }
  }

  await browser.close();
  console.log("Amount of properties found: " + properties.length);
  return JSON.stringify(properties);
}

async function makeDecision(originalInput: string, properties: string) {
  const response = await client.responses.create({
    model: "gpt-4o-mini",
    instructions: decisionMakingContext,
    input: originalInput + "\n\n" + properties
  });

  return response.output_text;
}

async function main() {
  const input = "Quiero comprar un apartamento en Punta Carretas, Montevideo, con al menos 3 dormitorios y 2 baños. Debe tener terraza o balcón, ser luminoso, con aire acondicionado y calefacción. Que permita mascotas, tenga garaje y piscina en el edificio si es posible. Me interesa que esté cerca de supermercados y transporte público, y el precio no supere los 250.000 dólares.";
  const url = await generateLink(input);
  console.log("URL generado:", url);

  const properties = await scrapeAllProperties(url);
  //console.log("Propiedades encontradas:", properties);

  const decision = await makeDecision(input, properties);
  console.log(decision);
}

main();