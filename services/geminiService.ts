
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Helper to sanitize JSON string if model returns markdown blocks
const parseJson = (text: string) => {
    try {
        const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleaned);
    } catch (e) {
        return {};
    }
};

export const analyzeFileStructure = async (sheetsPreview: Record<string, any[][]>) => {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `
      Task: Analyze Excel File Structure.
      
      Input Data (First 20 rows of each sheet):
      ${JSON.stringify(sheetsPreview, null, 2)}
      
      Identify:
      1. Which sheet likely contains the main data table?
      2. Which row number (1-based) is the Header Row? (Look for row with columns like "ID", "Name", "Type", "Code", etc.)
      3. Which row does the actual Data start? (Usually Header Row + 1)
      4. Is there a clear End Row? (e.g., footer text). If not, use "auto".
      5. Are there any data quality issues? (e.g., "Metadata in row 2", "Empty rows").
      
      Return JSON.
    `,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    sheetName: { type: Type.STRING, description: "The name of the sheet with the main data" },
                    headerRow: { type: Type.INTEGER, description: "1-based row index of headers" },
                    dataStartRow: { type: Type.INTEGER, description: "1-based row index where data begins" },
                    dataEndRow: { type: Type.STRING, description: "1-based row index of end, or 'auto'" },
                    warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
                    explanation: { type: Type.STRING }
                },
                required: ['sheetName', 'headerRow', 'dataStartRow', 'dataEndRow', 'warnings']
            }
        }
    });

    return parseJson(response.text || '{}');
};

export const analyzeArchitectureSplit = async (headers: string[], userGoal: string) => {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash', // Using 2.5 Flash for better structured output speed/cost balance
    contents: `
      Task: Enterprise Architecture (EA) Data Extraction.
      Headers: ${headers.join(', ')}
      User Instruction: ${userGoal}
      
      Identify:
      1. Architecture Elements (Objects): Which columns belong to which entity (e.g., "Application System"). Define their name, attributes, and primary key.
      2. Relationship Types: Which columns represent links between these elements. Identify source entity, target entity, and extra attributes.

      IMPORTANT:
      - Return "mappings" as a list of objects where "sourceColumn" is the Excel Header and "targetAttribute" is the Output Name.
      - Relationships MUST include mappings for "源端" (Source ID) and "目标端" (Target ID).
    `,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          elements: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: "Name of the object type (e.g., Application)" },
                primaryKey: { type: Type.STRING, description: "The Excel column that acts as the unique ID" },
                mappings: { 
                  type: Type.ARRAY,
                  description: "List of attribute mappings",
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      sourceColumn: { type: Type.STRING, description: "Excel Header" },
                      targetAttribute: { type: Type.STRING, description: "Output Field Name" }
                    },
                    required: ['sourceColumn', 'targetAttribute']
                  }
                }
              },
              required: ['name', 'primaryKey', 'mappings']
            }
          },
          relationships: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: "Name of the relationship (e.g., Contains)" },
                sourceElement: { type: Type.STRING, description: "Name of the source object type" },
                targetElement: { type: Type.STRING, description: "Name of the target object type" },
                mappings: { 
                  type: Type.ARRAY,
                  description: "List of attribute mappings",
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      sourceColumn: { type: Type.STRING, description: "Excel Header" },
                      targetAttribute: { type: Type.STRING, description: "Output Field Name" }
                    },
                    required: ['sourceColumn', 'targetAttribute']
                  }
                }
              },
              required: ['name', 'sourceElement', 'targetElement', 'mappings']
            }
          },
          explanation: { type: Type.STRING }
        },
        required: ['elements', 'relationships', 'explanation']
      }
    }
  });

  const rawResult = parseJson(response.text || '{}');

  // Convert schema array format back to Record<string, string> for the app
  const elements = (rawResult.elements || []).map((el: any) => ({
    name: el.name,
    primaryKey: el.primaryKey,
    attributeMapping: (el.mappings || []).reduce((acc: Record<string, string>, m: any) => {
      if (m.sourceColumn && m.targetAttribute) {
        acc[m.sourceColumn] = m.targetAttribute;
      }
      return acc;
    }, {})
  }));

  const relationships = (rawResult.relationships || []).map((rel: any) => ({
    name: rel.name,
    sourceElement: rel.sourceElement,
    targetElement: rel.targetElement,
    attributeMapping: (rel.mappings || []).reduce((acc: Record<string, string>, m: any) => {
      if (m.sourceColumn && m.targetAttribute) {
        acc[m.sourceColumn] = m.targetAttribute;
      }
      return acc;
    }, {})
  }));

  return {
    elements,
    relationships,
    explanation: rawResult.explanation
  };
};
