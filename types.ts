
export interface ExcelRow {
  [key: string]: any;
}

export interface SheetData {
  name: string;
  data: ExcelRow[];
  headers: string[];
}

export interface FileStructureAnalysis {
  sheetName: string;
  headerRow: number; // 1-based index
  dataStartRow: number; // 1-based index
  dataEndRow: number | 'auto'; // 1-based index or 'auto'
  warnings: string[];
  explanation: string;
}

export interface ArchitectureElement {
  id: string; // Internal UUID for UI handling
  name: string;
  primaryKey: string;
  // attributeMapping is { [excelHeader]: outputName }
  attributeMapping: Record<string, string>; 
}

export interface RelationshipType {
  id: string; // Internal UUID for UI handling
  name: string;
  sourceElement: string;
  targetElement: string;
  // attributeMapping is { [excelHeader]: outputName }
  attributeMapping: Record<string, string>;
}

export interface ArchitectureModel {
  elements: ArchitectureElement[];
  relationships: RelationshipType[];
  explanation?: string;
}

export interface ProcessedFile {
  name: string;
  blob: Blob;
  preview: ExcelRow[];
}
