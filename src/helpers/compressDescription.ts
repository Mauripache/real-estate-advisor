export function compressDescription(desc: string): string {
  if (!desc) return "N/A";

  return desc
    // normalize
    .replace(/<[^>]+>/g, "")          // remove HTML tags
    .replace(/[.,;:!?()\[\]{}|]/g, "") // remove punctuation
    .replace(/\s+/g, " ")               // collapse spaces
    .toLowerCase().trim()

    // split into words and filter
    .split(" ")
    .filter(word =>
      // keep numbers
      /\d+/.test(word) ||

      // keep property-specific keywords
      /(inmobiliaria|comisi[oó]n|norte|sur|este|oeste|cocina|kitchenette|semi[-\s]?integrada|independiente|ggcc|comunes|dormitorio[s]?|bañ[oa]s?|toilette|m2|metros|superficie|área|estrenar|estrena|reciclaje|renovar|remodelado|garage|cochera|estacionamiento|descubierto|techado|terraza|balc[oó]n|azotea|patio|jard[ií]n|altillo|s[oó]tano|servicio|living|comedor|living comedor|contrafrente|frente|piso[s]?|planta[s]?|planta baja|d[uú]plex|tr[ií]plex|orientaci[oó]n|luminoso|ventilaci[oó]n|ventilaci[oó]n cruzada|ascensor|barbacoa|parrillero|piscina|amenities|gimnasio|fitness|sal[oó]n|sum|coworking|business|lavadero|laundry|terraza lavadero|sol[aá]rium|seguridad|vigilancia|cctv|c[aá]maras|aire acondicionado|previsi[oó]n a\.?a\.?|calefacci[oó]n|caldereta|estufa|leña|agua caliente|calef[oó]n|luminosidad|promovida|18\.795|exoneraci[oó]n|fiscal|renta|con renta|ideal inversor|gastos comunes|expensas|contribuci[oó]n|primaria|hipoteca|financiaci[oó]n|banco|pr[eé]stamo|servicios|locomoci[oó]n|facultad|pr[oó]ximo|cerca|vista|despejada|mar|bah[ií]a)/i.test(word)
    )
    .slice(0, 60) // cap length to ~60 tokens
    .join(" ");
}