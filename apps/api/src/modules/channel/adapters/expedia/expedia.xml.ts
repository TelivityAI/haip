import { XMLBuilder, XMLParser } from 'fast-xml-parser';

/**
 * Expedia EQC XML helpers. EQC messages are plain XML (not OTA/SOAP) with a
 * versioned namespace on the root element and an in-body <Authentication>
 * element rather than HTTP auth.
 */
const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressEmptyNode: true,
});

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
});

/** Build an EQC XML message: `<rootName xmlns=ns ...>body</rootName>`. */
export function buildExpediaXml(
  rootName: string,
  namespace: string,
  body: Record<string, unknown>,
): string {
  const envelope = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    [rootName]: { '@_xmlns': namespace, ...body },
  };
  return builder.build(envelope);
}

/**
 * Parse an EQC response. EQC reports errors as one or more `<Error>` elements
 * (with `code`/`id` + text) on the root; absence of errors = success.
 */
export function parseExpediaResponse(xmlString: string): {
  success: boolean;
  messageName: string;
  data: Record<string, unknown>;
  errors: Array<{ code: string; message: string }>;
} {
  const parsed = parser.parse(xmlString);
  const rootKeys = Object.keys(parsed).filter((k) => k !== '?xml');
  const messageName = rootKeys[0] ?? 'Unknown';
  const root = (parsed[messageName] ?? {}) as Record<string, any>;

  const errors: Array<{ code: string; message: string }> = [];
  const errEl = root['Error'];
  if (errEl) {
    const list = Array.isArray(errEl) ? errEl : [errEl];
    for (const e of list) {
      errors.push({
        code: String(e['@_code'] ?? e['@_id'] ?? 'ERROR'),
        message: String(e['#text'] ?? e['@_text'] ?? 'Unknown error'),
      });
    }
  }
  return { success: errors.length === 0, messageName, data: root, errors };
}
