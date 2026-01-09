import React, { useState, useCallback, useEffect } from 'react';
import { 
  FileSpreadsheet, 
  Upload, 
  Settings, 
  Download, 
  CheckCircle2, 
  ArrowRight,
  BrainCircuit,
  Loader2,
  Box,
  Share2,
  Plus,
  Trash2,
  ArrowLeft,
  Save,
  AlertTriangle,
  Bot
} from 'lucide-react';
import { SheetData, ExcelRow, ProcessedFile, ArchitectureModel, ArchitectureElement, RelationshipType, FileStructureAnalysis } from './types';
import { analyzeArchitectureSplit, analyzeFileStructure } from './services/geminiService';

declare const XLSX: any;

// Helper to generate IDs
const generateId = () => Math.random().toString(36).substr(2, 9);

const App: React.FC = () => {
  // State
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [wb, setWb] = useState<any>(null); // Raw Workbook
  const [fileStructure, setFileStructure] = useState<FileStructureAnalysis | null>(null);
  const [isEditingStructure, setIsEditingStructure] = useState(false);
  
  // Analyzed Data used for Step 2+
  const [fileData, setFileData] = useState<SheetData | null>(null);
  
  // AI Config
  const [userGoal, setUserGoal] = useState('将数据拆分为“应用系统”和“应用模块”对象，并提取它们之间的“包含”和“关联”关系。');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isStructureAnalyzing, setIsStructureAnalyzing] = useState(false);
  
  // Data Model (Editable)
  // FIXED: Initialize with empty arrays. Previous error was caused by referencing undefined variables here.
  const [archModel, setArchModel] = useState<ArchitectureModel>({ elements: [], relationships: [] });
  
  // Output
  const [processedFiles, setProcessedFiles] = useState<ProcessedFile[]>([]);

  // Initial State Reset for archModel
  useEffect(() => {
     setArchModel({ elements: [], relationships: [] });
  }, []);

  // --- STEP 1: Upload & Structure Analysis ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setWb(null);
    setFileStructure(null);
    setFileData(null);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result;
      const workbook = XLSX.read(bstr, { type: 'binary' });
      setWb(workbook);
      
      // Perform Structure Analysis
      setIsStructureAnalyzing(true);
      try {
        // Create a preview of all sheets (first 20 rows)
        const sheetsPreview: Record<string, any[][]> = {};
        workbook.SheetNames.forEach((name: string) => {
            const sheet = workbook.Sheets[name];
            // Get raw array of arrays
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 0, defval: '' }).slice(0, 20);
            sheetsPreview[name] = rows as any[][];
        });

        const analysis = await analyzeFileStructure(sheetsPreview);
        setFileStructure({
            sheetName: analysis.sheetName || workbook.SheetNames[0],
            headerRow: analysis.headerRow || 1,
            dataStartRow: analysis.dataStartRow || 2,
            dataEndRow: analysis.dataEndRow || 'auto',
            warnings: analysis.warnings || [],
            explanation: analysis.explanation || ''
        });
      } catch (err) {
          console.error(err);
          alert("结构分析失败，请检查API Key或文件格式");
      } finally {
          setIsStructureAnalyzing(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  // When Structure Changes, Parse Data
  const parseDataFromStructure = useCallback(() => {
    if (!wb || !fileStructure) return null;
    
    const ws = wb.Sheets[fileStructure.sheetName];
    if (!ws) return null;

    // Convert 'auto' end row to undefined for XLSX
    const endRow = fileStructure.dataEndRow === 'auto' ? undefined : Number(fileStructure.dataEndRow);
    
    // We need to parse headers manually from the specified row
    // XLSX utils are 0-based for ranges. headerRow is 1-based.
    const headerRowIdx = fileStructure.headerRow - 1;
    
    // Get full sheet data as array of arrays first to control parsing perfectly
    const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
    
    if (allRows.length <= headerRowIdx) return null;

    const headers = allRows[headerRowIdx].map((h: any) => String(h).trim()).filter((h: any) => h);
    
    // Extract data rows
    const startRowIdx = fileStructure.dataStartRow - 1;
    const dataRows = allRows.slice(startRowIdx, endRow); // slice is end-exclusive, but endRow is 1-based index, so it works out to include up to that row index if we treat it as count? No.
    // If user says End Row 100, they mean include row 100. Slice needs index 100 to exclude it?
    // Let's rely on slice index. Index 0 is Row 1. Index 99 is Row 100. Slice(0, 100) gets 0..99.
    
    // Map array to objects based on headers
    const mappedData: ExcelRow[] = dataRows.map((row: any[]) => {
        const obj: ExcelRow = {};
        headers.forEach((h: string, i: number) => {
            // Find the column index in the row that matches the header index
            // Note: The data row array might be sparse or offset if we just take it from slice
            // Actually, sheet_to_json with header:1 gives sparse arrays.
            // A safer way is to use XLSX range option.
            obj[h] = row[i]; 
        });
        return obj;
    });

    return {
        name: fileStructure.sheetName,
        headers,
        data: mappedData
    };
  }, [wb, fileStructure]);

  // Handle Architecture Analysis (Transition to Step 2)
  const handleAnalyzeArchitecture = async () => {
    const data = parseDataFromStructure();
    if (!data || data.headers.length === 0) {
        alert("无法解析数据，请检查结构设置（Sheet或表头行）");
        return;
    }
    setFileData(data); // Commit the parsed data
    
    setIsAnalyzing(true);
    try {
      const plan = await analyzeArchitectureSplit(data.headers, userGoal);
      
      // Hydrate with IDs for UI handling
      const elementsWithIds = (plan.elements || []).map((e: any) => ({ ...e, id: generateId() }));
      const relationshipsWithIds = (plan.relationships || []).map((r: any) => ({ ...r, id: generateId() }));
      
      setArchModel({
        elements: elementsWithIds,
        relationships: relationshipsWithIds,
        explanation: plan.explanation
      });
      setStep(2);
    } catch (error) {
      console.error("Architecture analysis failed", error);
      alert("AI analysis failed. Please try again or check console for details.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // --- STEP 2: Edit Objects ---
  const updateElement = (id: string, field: keyof ArchitectureElement, value: any) => {
    setArchModel(prev => ({
      ...prev,
      elements: prev.elements.map(e => e.id === id ? { ...e, [field]: value } : e)
    }));
  };

  const addMappingToElement = (id: string) => {
    setArchModel(prev => ({
      ...prev,
      elements: prev.elements.map(e => {
        if (e.id === id) {
          const firstHeader = fileData?.headers[0] || '';
          return { ...e, attributeMapping: { ...e.attributeMapping, [firstHeader]: firstHeader } };
        }
        return e;
      })
    }));
  };

  const removeMappingFromElement = (id: string, keyToRemove: string) => {
    setArchModel(prev => ({
      ...prev,
      elements: prev.elements.map(e => {
        if (e.id === id) {
          const newMap = { ...e.attributeMapping };
          delete newMap[keyToRemove];
          return { ...e, attributeMapping: newMap };
        }
        return e;
      })
    }));
  };
  
  const updateElementMappingKey = (id: string, oldKey: string, newKey: string) => {
    setArchModel(prev => ({
      ...prev,
      elements: prev.elements.map(e => {
        if (e.id === id) {
           const val = e.attributeMapping[oldKey];
           const newMap = { ...e.attributeMapping };
           delete newMap[oldKey];
           newMap[newKey] = val;
           return { ...e, attributeMapping: newMap };
        }
        return e;
      })
    }));
  };

  const updateElementMappingValue = (id: string, key: string, newValue: string) => {
     setArchModel(prev => ({
      ...prev,
      elements: prev.elements.map(e => {
        if (e.id === id) {
           return { ...e, attributeMapping: { ...e.attributeMapping, [key]: newValue } };
        }
        return e;
      })
    }));
  };

  const addElement = () => {
    setArchModel(prev => ({
      ...prev,
      elements: [...prev.elements, { id: generateId(), name: '新对象', primaryKey: fileData?.headers[0] || '', attributeMapping: {} }]
    }));
  };
  
  const removeElement = (id: string) => {
    setArchModel(prev => ({
      ...prev,
      elements: prev.elements.filter(e => e.id !== id)
    }));
  };

  // --- STEP 3: Edit Relationships ---
  const updateRelationship = (id: string, field: keyof RelationshipType, value: any) => {
    setArchModel(prev => ({
      ...prev,
      relationships: prev.relationships.map(r => r.id === id ? { ...r, [field]: value } : r)
    }));
  };

  const addMappingToRel = (id: string) => {
    setArchModel(prev => ({
      ...prev,
      relationships: prev.relationships.map(r => {
        if (r.id === id) {
          const firstHeader = fileData?.headers[0] || '';
          return { ...r, attributeMapping: { ...r.attributeMapping, [firstHeader]: firstHeader } };
        }
        return r;
      })
    }));
  };

  const removeMappingFromRel = (id: string, keyToRemove: string) => {
    setArchModel(prev => ({
      ...prev,
      relationships: prev.relationships.map(r => {
        if (r.id === id) {
          const newMap = { ...r.attributeMapping };
          delete newMap[keyToRemove];
          return { ...r, attributeMapping: newMap };
        }
        return r;
      })
    }));
  };
  
  const updateRelMappingKey = (id: string, oldKey: string, newKey: string) => {
    setArchModel(prev => ({
      ...prev,
      relationships: prev.relationships.map(r => {
        if (r.id === id) {
           const val = r.attributeMapping[oldKey];
           const newMap = { ...r.attributeMapping };
           delete newMap[oldKey];
           newMap[newKey] = val;
           return { ...r, attributeMapping: newMap };
        }
        return r;
      })
    }));
  };

  const updateRelMappingValue = (id: string, key: string, newValue: string) => {
     setArchModel(prev => ({
      ...prev,
      relationships: prev.relationships.map(r => {
        if (r.id === id) {
           return { ...r, attributeMapping: { ...r.attributeMapping, [key]: newValue } };
        }
        return r;
      })
    }));
  };

  const addRelationship = () => {
    setArchModel(prev => ({
      ...prev,
      relationships: [...prev.relationships, { 
        id: generateId(), 
        name: '新关系', 
        sourceElement: prev.elements[0]?.name || '', 
        targetElement: prev.elements[0]?.name || '', 
        attributeMapping: { '源端': '', '目标端': '' } 
      }]
    }));
  };

  const removeRelationship = (id: string) => {
    setArchModel(prev => ({
      ...prev,
      relationships: prev.relationships.filter(r => r.id !== id)
    }));
  };

  // --- STEP 4: Execution ---
  const executeTransformation = useCallback(() => {
    if (!fileData || !archModel) return;

    // Create a new Workbook
    const wb = XLSX.utils.book_new();

    // --- 1. Generate "架构元素定义" Sheet ---
    const defData = archModel.elements.flatMap(elem => {
        return Object.entries(elem.attributeMapping).map(([src, target]) => ({
            '架构元素名称[*]': elem.name,
            '属性名称[*]': target,
            '是否主键': src === elem.primaryKey ? '是' : '否'
        }));
    });
    
    if (defData.length > 0) {
        const wsDef = XLSX.utils.json_to_sheet(defData);
        XLSX.utils.book_append_sheet(wb, wsDef, "架构元素定义");
    }

    // --- 2. Generate Element Instance Sheets ---
    archModel.elements.forEach((elem) => {
      // Find the target attribute name that corresponds to the PK source column
      const pkTargetAttr = elem.attributeMapping[elem.primaryKey];
      // If no valid PK mapping, just skip or use best effort (though validation should prevent this)
      
      const instances: ExcelRow[] = fileData.data.map((row: ExcelRow) => {
        const inst: ExcelRow = {};
        Object.entries(elem.attributeMapping).forEach(([srcCol, targetAttr]) => {
          let headerName = targetAttr;
          // If this source column is the primary key, append [主键] to the header
          if (srcCol === elem.primaryKey) {
             headerName = `${targetAttr}[主键]`;
          }
          // Fix: Ensure we use string key for row access
          inst[String(headerName)] = (row as any)[String(srcCol)];
        });
        return inst;
      });

      // Construct the expected PK Header Name for filtering
      const pkHeaderName = pkTargetAttr ? `${pkTargetAttr}[主键]` : '';

      // Filter empty PKs and Deduplicate
      const validInstances = instances.filter(i => !pkHeaderName || i[pkHeaderName]);
      
      // Dedup based on PK if available, otherwise just use JSON string
      const uniqueInstances = Array.from(new Map(validInstances.map(item => [
          pkHeaderName && item[pkHeaderName] ? item[pkHeaderName] : JSON.stringify(item), 
          item
      ])).values());

      if (uniqueInstances.length > 0) {
          const ws = XLSX.utils.json_to_sheet(uniqueInstances);
          XLSX.utils.book_append_sheet(wb, ws, elem.name);
      }
    });

    // --- 3. Generate Relationship Sheets (Optional but preserved) ---
    // If relationships exist, we add them as well, though specific format wasn't requested for them.
    archModel.relationships.forEach((rel) => {
      const instances: ExcelRow[] = fileData.data.map((row: ExcelRow) => {
        const inst: ExcelRow = {};
        Object.entries(rel.attributeMapping).forEach(([srcCol, targetAttr]) => {
          inst[String(targetAttr)] = (row as any)[String(srcCol)];
        });
        return inst;
      }).filter(inst => inst['源端'] && inst['目标端']);

      if (instances.length > 0) {
          const ws = XLSX.utils.json_to_sheet(instances);
          XLSX.utils.book_append_sheet(wb, ws, rel.name);
      }
    });

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    
    setProcessedFiles([{
        name: '架构全景图_v2.xlsx',
        blob: new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        preview: defData.slice(0, 10) // Show metadata sheet as preview
    }]);

    setStep(4);
  }, [fileData, archModel]);


  // --- UI COMPONENTS ---

  const StepIndicator = () => (
    <div className="flex justify-between items-center mb-10 px-4 max-w-4xl mx-auto w-full">
      {[
        { n: 1, label: '上传与分析', icon: Upload },
        { n: 2, label: '对象定义', icon: Box },
        { n: 3, label: '关系定义', icon: Share2 },
        { n: 4, label: '导出结果', icon: Download }
      ].map((s, idx) => (
        <div key={s.n} className="flex flex-col items-center relative z-10">
           <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg transition-all duration-500 ${step >= s.n ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'bg-slate-200 text-slate-400'}`}>
             {step > s.n ? <CheckCircle2 size={24} /> : <s.icon size={20} />}
           </div>
           <span className={`text-xs font-bold mt-2 uppercase tracking-wide ${step >= s.n ? 'text-indigo-600' : 'text-slate-400'}`}>{s.label}</span>
           {idx < 3 && (
             <div className={`absolute top-6 left-full w-[calc(100vw/5)] h-1 -translate-y-1/2 -z-10 transition-all duration-500 ${step > s.n ? 'bg-indigo-600' : 'bg-slate-200'}`} />
           )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-20 px-8 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <div className="bg-gradient-to-br from-indigo-600 to-blue-500 p-2.5 rounded-xl text-white shadow-indigo-200 shadow-lg">
            <BrainCircuit size={24} />
          </div>
          <div>
            <h1 className="font-bold text-xl text-slate-900 tracking-tight">FlexiArch EA</h1>
            <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">Intelligent ETL Wizard</p>
          </div>
        </div>
        {step > 1 && (
            <button 
                onClick={() => setStep(Math.max(1, step - 1) as 1 | 2 | 3 | 4)}
                className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-bold text-sm px-4 py-2 rounded-lg hover:bg-slate-100 transition-all"
            >
                <ArrowLeft size={16} /> 上一步
            </button>
        )}
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto p-8 flex flex-col">
        <StepIndicator />

        {/* STEP 1: UPLOAD & ANALYZE */}
        {step === 1 && (
          <div className="animate-in fade-in zoom-in-95 duration-500 space-y-8">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 min-h-[500px]">
               {/* 1.1 Upload State */}
               {!wb && !isStructureAnalyzing && (
                 <div className="text-center py-20">
                    <div className="w-20 h-20 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-6 text-indigo-600">
                        <FileSpreadsheet size={40} />
                    </div>
                    <h2 className="text-3xl font-black text-slate-800 mb-4">上传原始架构数据</h2>
                    <p className="text-slate-500 mb-8 max-w-lg mx-auto">请上传包含混合数据的 Excel 文件。AI 将自动分析表结构、表头和数据范围。</p>
                    <label className="inline-flex cursor-pointer bg-slate-900 text-white px-8 py-4 rounded-xl font-bold items-center gap-3 transition-all hover:bg-indigo-600 hover:shadow-xl hover:shadow-indigo-200 hover:-translate-y-1">
                        <Upload size={20} />
                        选择 Excel 文件
                        <input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} />
                    </label>
                 </div>
               )}

               {/* 1.2 Loading State */}
               {isStructureAnalyzing && (
                   <div className="text-center py-32 flex flex-col items-center">
                       <Loader2 size={48} className="animate-spin text-indigo-600 mb-4" />
                       <h3 className="text-xl font-bold text-slate-800">AI 正在分析文件结构...</h3>
                       <p className="text-slate-500 mt-2">正在识别工作表、表头行和有效数据区域</p>
                   </div>
               )}

               {/* 1.3 Split View: Preview & AI Analysis */}
               {wb && fileStructure && !isStructureAnalyzing && (
                   <div className="flex flex-col lg:flex-row gap-6 h-full">
                       {/* Left: Table Preview */}
                       <div className="flex-1 overflow-hidden flex flex-col border-r border-slate-100 pr-6">
                           <div className="flex items-center justify-between mb-4">
                               <h3 className="font-bold text-lg text-slate-700 flex items-center gap-2">
                                   <FileSpreadsheet size={20} className="text-emerald-600"/> 
                                   文件预览: {fileStructure.sheetName}
                               </h3>
                               <div className="text-xs font-medium text-slate-400 bg-slate-100 px-3 py-1 rounded-full">只显示前 15 行</div>
                           </div>
                           
                           <div className="overflow-auto border border-slate-200 rounded-xl flex-1 bg-slate-50">
                               {/* Render a raw-ish table from the WB for visual context */}
                               <table className="w-full text-xs border-collapse">
                                   <tbody>
                                       {(XLSX.utils.sheet_to_json(wb.Sheets[fileStructure.sheetName], { header: 1, range: 0, defval: '' }) as any[][]).slice(0, 15).map((row, rIdx) => {
                                           const isHeader = rIdx + 1 === fileStructure.headerRow;
                                           const isData = rIdx + 1 >= fileStructure.dataStartRow && (fileStructure.dataEndRow === 'auto' || rIdx + 1 <= Number(fileStructure.dataEndRow));
                                           return (
                                               <tr key={rIdx} className={`${isHeader ? 'bg-indigo-100 font-bold text-indigo-900' : isData ? 'bg-white' : 'bg-slate-100 text-slate-400'}`}>
                                                   <td className="p-2 border-r border-slate-200 text-[10px] w-10 text-center select-none opacity-50">{rIdx + 1}</td>
                                                   {row.slice(0, 8).map((cell: any, cIdx: number) => (
                                                       <td key={cIdx} className="p-2 border border-slate-200 truncate max-w-[120px]" title={String(cell)}>
                                                           {String(cell)}
                                                       </td>
                                                   ))}
                                               </tr>
                                           );
                                       })}
                                   </tbody>
                               </table>
                           </div>
                       </div>

                       {/* Right: AI Assistant Panel */}
                       <div className="w-full lg:w-[360px] flex flex-col gap-4">
                           <div className="bg-indigo-600 text-white p-4 rounded-xl shadow-lg shadow-indigo-200 flex items-center gap-3">
                               <div className="bg-white/20 p-2 rounded-lg"><Bot size={24} /></div>
                               <div>
                                   <div className="font-bold">AI 导入助手</div>
                                   <div className="text-xs opacity-80">智能分析 · 实时预览</div>
                               </div>
                           </div>

                           <div className="bg-white border-2 border-indigo-50 rounded-xl p-5 shadow-sm space-y-4">
                               <div className="flex items-center gap-2 mb-2">
                                   <CheckCircle2 size={18} className="text-green-500" />
                                   <span className="font-bold text-slate-800">文件结构分析完成</span>
                               </div>
                               
                               <div className="space-y-3 text-sm">
                                   <div className="flex justify-between items-center border-b border-dashed border-slate-100 pb-2">
                                       <span className="text-slate-500">工作表</span>
                                       {isEditingStructure ? (
                                           <select 
                                             value={fileStructure.sheetName}
                                             onChange={(e) => setFileStructure({...fileStructure, sheetName: e.target.value})}
                                             className="text-right font-bold text-slate-800 bg-slate-50 border rounded px-2 py-1"
                                           >
                                               {wb.SheetNames.map((n: string) => <option key={n} value={n}>{n}</option>)}
                                           </select>
                                       ) : (
                                           <span className="font-bold text-slate-800">{fileStructure.sheetName}</span>
                                       )}
                                   </div>
                                   <div className="flex justify-between items-center border-b border-dashed border-slate-100 pb-2">
                                       <span className="text-slate-500">表头行</span>
                                       {isEditingStructure ? (
                                           <input 
                                             type="number" 
                                             value={fileStructure.headerRow}
                                             onChange={(e) => setFileStructure({...fileStructure, headerRow: Number(e.target.value)})}
                                             className="w-16 text-right font-bold text-indigo-600 bg-slate-50 border rounded px-1"
                                           />
                                       ) : (
                                           <span className="font-bold text-indigo-600">第 {fileStructure.headerRow} 行</span>
                                       )}
                                   </div>
                                   <div className="flex justify-between items-center border-b border-dashed border-slate-100 pb-2">
                                       <span className="text-slate-500">数据范围</span>
                                       {isEditingStructure ? (
                                           <div className="flex items-center gap-1">
                                               <input 
                                                 type="number" 
                                                 value={fileStructure.dataStartRow}
                                                 onChange={(e) => setFileStructure({...fileStructure, dataStartRow: Number(e.target.value)})}
                                                 className="w-12 text-center text-xs border rounded"
                                               />
                                               -
                                               <input 
                                                 type="text" 
                                                 value={fileStructure.dataEndRow}
                                                 onChange={(e) => setFileStructure({...fileStructure, dataEndRow: e.target.value === 'auto' ? 'auto' : Number(e.target.value)})}
                                                 placeholder="Auto"
                                                 className="w-12 text-center text-xs border rounded"
                                               />
                                           </div>
                                       ) : (
                                           <span className="font-bold text-green-600">
                                               第 {fileStructure.dataStartRow} - {fileStructure.dataEndRow === 'auto' ? '末尾' : fileStructure.dataEndRow} 行
                                           </span>
                                       )}
                                   </div>
                                   <div className="flex justify-between items-center">
                                       <span className="text-slate-500">有效记录</span>
                                       <span className="font-bold text-slate-800">
                                            {(() => {
                                                const d = parseDataFromStructure();
                                                return d ? d.data.length + ' 条' : '...';
                                            })()}
                                       </span>
                                   </div>
                               </div>
                           </div>

                           {fileStructure.warnings.length > 0 && (
                               <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-xs text-amber-800">
                                   <div className="font-bold flex items-center gap-2 mb-2">
                                       <AlertTriangle size={14} /> 检测到潜在问题
                                   </div>
                                   <ul className="list-disc pl-4 space-y-1 opacity-80">
                                       {fileStructure.warnings.map((w, i) => <li key={i}>{w}</li>)}
                                   </ul>
                               </div>
                           )}
                           
                           <div className="flex gap-2 mt-2">
                               {isEditingStructure ? (
                                   <button 
                                     onClick={() => setIsEditingStructure(false)}
                                     className="flex-1 bg-slate-800 text-white py-2.5 rounded-lg font-bold text-sm hover:bg-slate-700"
                                   >
                                       完成调整
                                   </button>
                               ) : (
                                   <>
                                    <button 
                                      onClick={() => setIsEditingStructure(true)}
                                      className="flex-1 border border-slate-300 text-slate-600 py-2.5 rounded-lg font-bold text-sm hover:bg-slate-50"
                                    >
                                        <Settings size={14} className="inline mr-1" /> 需要调整
                                    </button>
                                    <button 
                                      onClick={() => {
                                          const d = parseDataFromStructure();
                                          if(d) {
                                            // Proceed to Goal Input logic within same view or next?
                                            // The design shows structure analysis. We should proceed to Goal Input.
                                            // But let's verify data first.
                                            setFileData(d);
                                          }
                                      }}
                                      className={`flex-1 ${fileData ? 'bg-green-600 hover:bg-green-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white py-2.5 rounded-lg font-bold text-sm shadow-md`}
                                    >
                                        {fileData ? <CheckCircle2 size={16} className="inline mr-1"/> : null}
                                        {fileData ? '已确认' : '分析正确'}
                                    </button>
                                   </>
                               )}
                           </div>
                           
                           {/* Goal Input Section - Visible only after confirmation (fileData exists) */}
                           {fileData && (
                               <div className="mt-4 animate-in slide-in-from-bottom-2 fade-in">
                                   <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                                       架构拆分指令 (AI Prompt)
                                   </label>
                                   <textarea 
                                        value={userGoal}
                                        onChange={(e) => setUserGoal(e.target.value)}
                                        className="w-full h-24 p-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none text-xs resize-none mb-3"
                                        placeholder="描述您希望如何拆分数据..."
                                    />
                                    <button 
                                        onClick={handleAnalyzeArchitecture}
                                        disabled={isAnalyzing}
                                        className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-lg"
                                    >
                                        {isAnalyzing ? <Loader2 className="animate-spin" size={16}/> : <BrainCircuit size={16}/>}
                                        {isAnalyzing ? '正在生成对象...' : '开始架构识别'}
                                    </button>
                               </div>
                           )}
                       </div>
                   </div>
               )}
            </div>
          </div>
        )}

        {/* STEP 2: EDIT OBJECTS */}
        {step === 2 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-500 space-y-6">
             <div className="flex justify-between items-end">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">确认对象定义</h2>
                    <p className="text-slate-500">AI 识别出以下实体对象。请检查并修正属性映射。</p>
                </div>
                <button onClick={addElement} className="text-sm font-bold text-indigo-600 bg-indigo-50 px-4 py-2 rounded-lg hover:bg-indigo-100 transition-colors flex items-center gap-2">
                    <Plus size={16} /> 添加新对象
                </button>
             </div>

             <div className="grid grid-cols-1 gap-6">
                {archModel.elements.map((elem, idx) => (
                    <div key={elem.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="bg-slate-50 p-4 border-b border-slate-200 flex flex-wrap gap-4 items-center justify-between">
                            <div className="flex items-center gap-4 flex-1">
                                <div className="bg-white p-2 rounded-lg shadow-sm text-indigo-600"><Box size={20} /></div>
                                <div className="flex flex-col">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">对象名称</label>
                                    <input 
                                        type="text" 
                                        value={elem.name} 
                                        onChange={(e) => updateElement(elem.id, 'name', e.target.value)}
                                        className="bg-transparent font-bold text-slate-800 border-b border-dashed border-slate-300 focus:border-indigo-500 outline-none w-40"
                                    />
                                </div>
                                <div className="flex flex-col">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">主键 (Unique ID)</label>
                                    <select 
                                        value={elem.primaryKey}
                                        onChange={(e) => updateElement(elem.id, 'primaryKey', e.target.value)}
                                        className="bg-transparent text-sm font-medium text-slate-700 border-b border-dashed border-slate-300 focus:border-indigo-500 outline-none w-40 py-0.5"
                                    >
                                        {fileData?.headers.map(h => <option key={h} value={h}>{h}</option>)}
                                    </select>
                                </div>
                            </div>
                            <button onClick={() => removeElement(elem.id)} className="text-slate-400 hover:text-red-500 p-2"><Trash2 size={18} /></button>
                        </div>
                        
                        <div className="p-4 bg-white">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-xs font-bold text-slate-400 uppercase">属性映射 (Excel列 -> 对象属性)</span>
                                <button onClick={() => addMappingToElement(elem.id)} className="text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1"><Plus size={12}/> 添加属性</button>
                            </div>
                            <div className="space-y-2">
                                {Object.entries(elem.attributeMapping).map(([key, val], mIdx) => (
                                    <div key={mIdx} className="flex items-center gap-2 group">
                                        <ArrowRight size={14} className="text-slate-300" />
                                        <select 
                                            value={key}
                                            onChange={(e) => updateElementMappingKey(elem.id, key, e.target.value)}
                                            className="flex-1 text-sm border border-slate-200 rounded px-2 py-1.5 bg-slate-50 focus:border-indigo-500 outline-none"
                                        >
                                             {fileData?.headers.map(h => <option key={h} value={h}>{h}</option>)}
                                        </select>
                                        <span className="text-slate-400">→</span>
                                        <input 
                                            type="text" 
                                            value={val}
                                            onChange={(e) => updateElementMappingValue(elem.id, key, e.target.value)}
                                            className="flex-1 text-sm border border-slate-200 rounded px-2 py-1.5 focus:border-indigo-500 outline-none"
                                            placeholder="输出属性名"
                                        />
                                        <button onClick={() => removeMappingFromElement(elem.id, key)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14} /></button>
                                    </div>
                                ))}
                                {Object.keys(elem.attributeMapping).length === 0 && (
                                    <p className="text-sm text-slate-400 italic py-2">无属性映射</p>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
             </div>

             <div className="flex justify-end pt-6">
                <button 
                    onClick={() => setStep(3)}
                    className="bg-slate-900 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-indigo-600 transition-all"
                >
                    确认对象，下一步 <ArrowRight size={18} />
                </button>
             </div>
          </div>
        )}

        {/* STEP 3: EDIT RELATIONSHIPS */}
        {step === 3 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-500 space-y-6">
             <div className="flex justify-between items-end">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">确认关系定义</h2>
                    <p className="text-slate-500">定义对象之间的连接关系。必须包含“源端”和“目标端”。</p>
                </div>
                <button onClick={addRelationship} className="text-sm font-bold text-orange-600 bg-orange-50 px-4 py-2 rounded-lg hover:bg-orange-100 transition-colors flex items-center gap-2">
                    <Plus size={16} /> 添加新关系
                </button>
             </div>

             <div className="grid grid-cols-1 gap-6">
                {archModel.relationships.map((rel, idx) => (
                    <div key={rel.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="bg-slate-50 p-4 border-b border-slate-200 flex flex-wrap gap-6 items-center justify-between">
                            <div className="flex items-center gap-4 flex-1">
                                <div className="bg-white p-2 rounded-lg shadow-sm text-orange-500"><Share2 size={20} /></div>
                                <div className="flex flex-col">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">关系名称</label>
                                    <input 
                                        type="text" 
                                        value={rel.name} 
                                        onChange={(e) => updateRelationship(rel.id, 'name', e.target.value)}
                                        className="bg-transparent font-bold text-slate-800 border-b border-dashed border-slate-300 focus:border-orange-500 outline-none w-32"
                                    />
                                </div>
                                <div className="flex flex-col">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">源对象</label>
                                    <select 
                                        value={rel.sourceElement}
                                        onChange={(e) => updateRelationship(rel.id, 'sourceElement', e.target.value)}
                                        className="bg-transparent text-sm font-medium text-slate-700 border-b border-dashed border-slate-300 focus:border-orange-500 outline-none w-32 py-0.5"
                                    >
                                        {archModel.elements.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                                    </select>
                                </div>
                                <div className="text-slate-300"><ArrowRight size={16} /></div>
                                <div className="flex flex-col">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">目标对象</label>
                                    <select 
                                        value={rel.targetElement}
                                        onChange={(e) => updateRelationship(rel.id, 'targetElement', e.target.value)}
                                        className="bg-transparent text-sm font-medium text-slate-700 border-b border-dashed border-slate-300 focus:border-orange-500 outline-none w-32 py-0.5"
                                    >
                                        {archModel.elements.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                                    </select>
                                </div>
                            </div>
                            <button onClick={() => removeRelationship(rel.id)} className="text-slate-400 hover:text-red-500 p-2"><Trash2 size={18} /></button>
                        </div>
                        
                        <div className="p-4 bg-white">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-xs font-bold text-slate-400 uppercase">属性映射 (必须映射到 '源端' 和 '目标端')</span>
                                <button onClick={() => addMappingToElement(rel.id)} className="text-xs font-bold text-orange-600 hover:underline flex items-center gap-1"><Plus size={12}/> 添加属性</button>
                            </div>
                            <div className="space-y-2">
                                {Object.entries(rel.attributeMapping).map(([key, val], mIdx) => (
                                    <div key={mIdx} className="flex items-center gap-2 group">
                                        <ArrowRight size={14} className="text-slate-300" />
                                        <select 
                                            value={key}
                                            onChange={(e) => updateRelMappingKey(rel.id, key, e.target.value)}
                                            className="flex-1 text-sm border border-slate-200 rounded px-2 py-1.5 bg-slate-50 focus:border-orange-500 outline-none"
                                        >
                                            <option value="">(空)</option>
                                             {fileData?.headers.map(h => <option key={h} value={h}>{h}</option>)}
                                        </select>
                                        <span className="text-slate-400">→</span>
                                        <input 
                                            type="text" 
                                            value={val}
                                            onChange={(e) => updateRelMappingValue(rel.id, key, e.target.value)}
                                            className={`flex-1 text-sm border rounded px-2 py-1.5 outline-none ${['源端', '目标端'].includes(val) ? 'border-orange-300 bg-orange-50 font-bold text-orange-700' : 'border-slate-200 focus:border-orange-500'}`}
                                            placeholder="输出属性名"
                                        />
                                        <button onClick={() => removeMappingFromRel(rel.id, key)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14} /></button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ))}
             </div>

             <div className="flex justify-end pt-6">
                <button 
                    onClick={executeTransformation}
                    className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
                >
                    <Save size={18} />
                    保存并生成文件
                </button>
             </div>
          </div>
        )}

        {/* STEP 4: PREVIEW & EXPORT */}
        {step === 4 && (
          <div className="animate-in fade-in zoom-in-95 duration-500 space-y-8">
             <div className="text-center mb-8">
                <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 size={32} />
                </div>
                <h2 className="text-3xl font-black text-slate-800">处理完成！</h2>
                <p className="text-slate-500 mt-2">已根据您的配置生成了 {processedFiles.length} 个文件</p>
             </div>

             <div className="flex justify-center mb-8">
                {processedFiles.map((file, idx) => (
                    <div key={idx} className="w-full max-w-4xl group bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl hover:border-indigo-100 transition-all overflow-hidden flex flex-col">
                        <div className={`p-5 flex items-center justify-between bg-indigo-50/30`}>
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg bg-indigo-100 text-indigo-600`}>
                                    <Box size={18} />
                                </div>
                                <span className="font-bold text-slate-700">{file.name} (含“架构元素定义”等多个 Sheet)</span>
                            </div>
                            <button 
                                onClick={() => {
                                    const url = URL.createObjectURL(file.blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = file.name;
                                    a.click();
                                }}
                                className="bg-white p-2 rounded-xl shadow-sm border border-slate-100 hover:text-indigo-600 hover:scale-110 transition-all"
                            >
                                <Download size={18} />
                            </button>
                        </div>
                        <div className="p-5 flex-1 overflow-auto max-h-80">
                             <div className="mb-2 text-xs font-bold text-slate-400 uppercase">预览: 架构元素定义 Sheet (前 10 行)</div>
                             <table className="w-full text-xs text-left border-collapse">
                                <thead className="text-slate-400 font-bold uppercase tracking-tighter sticky top-0 bg-white">
                                    <tr>
                                        {Object.keys((file.preview && file.preview[0]) || {}).map(k => (
                                            <th key={String(k)} className="pb-2 px-4 border-b border-slate-100">{String(k)}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {file.preview.map((row, ri) => (
                                        <tr key={ri} className="hover:bg-slate-50">
                                            {Object.values(row || {}).map((val, ci) => (
                                                <td key={ci} className="py-2 px-4 border-b border-slate-50 text-slate-600">{String(val ?? '')}</td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                             </table>
                        </div>
                    </div>
                ))}
            </div>

            <div className="flex justify-center p-8 gap-4">
                 <button 
                    onClick={() => {
                        setStep(1);
                        setWb(null);
                        setFileStructure(null);
                        setFileData(null);
                        setArchModel({ elements: [], relationships: [] });
                        setProcessedFiles([]);
                    }}
                    className="px-8 py-4 rounded-2xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-all"
                >
                    处理新文件
                </button>
                <button 
                    onClick={() => {
                        processedFiles.forEach(f => {
                             const url = URL.createObjectURL(f.blob);
                             const a = document.createElement('a');
                             a.href = url;
                             a.download = f.name;
                             a.click();
                        });
                    }}
                    className="bg-slate-900 text-white px-12 py-4 rounded-2xl font-black text-lg shadow-2xl shadow-slate-300 hover:scale-105 active:scale-95 transition-all flex items-center gap-4"
                >
                    <Download size={24} strokeWidth={3} />
                    下载架构全景图
                </button>
            </div>
        )}
      </main>
    </div>
  );
};

export default App;