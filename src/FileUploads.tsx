import { useState, useCallback, useEffect, createContext, useContext, useRef } from "react";
import type React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadDropzoneIcon,
  FileUploadTitle,
  FileUploadDescription,
  useFileUpload,
} from "@/components/ui/file-upload";
import {
  Item,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
} from "@/components/ui/item";
import { X } from "lucide-react";

// ---------------------------------------------------------------------------
// 1. Folder upload — PC or Switch save folder (multiple files, nested paths)
// ---------------------------------------------------------------------------

export interface SaveFolderFile {
  file: File;
  relativePath: string;
}

interface SaveFolderUploadProps {
  onFolderSelected: (files: SaveFolderFile[]) => void;
  onSelectedChange?: (selectedFilenames: Set<string>) => void;
  onClear?: () => void;
  clearSignal?: number;
  label?: string;
  fileMeta?: Map<string, { playerName: string; playtime: string }>;
  header?: React.ReactNode;
}

function isSaveFile(name: string) {
  return /^\d+\.bin$/.test(name);
}

/** Only accept save slots 0000-0015 and their slot_ metadata. */
function isValidSaveFile(name: string): boolean {
  // 0000.bin through 0015.bin
  const saveMatch = name.match(/^(\d{4})\.bin$/);
  if (saveMatch) {
    const num = parseInt(saveMatch[1], 10);
    return num >= 0 && num <= 15;
  }
  // slot_0000.bin through slot_0015.bin
  const slotMatch = name.match(/^slot_(\d{4})\.bin$/);
  if (slotMatch) {
    const num = parseInt(slotMatch[1], 10);
    return num >= 0 && num <= 15;
  }
  return false;
}

export function SaveFolderUpload(props: SaveFolderUploadProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [rootFiles, setRootFiles] = useState<File[]>([]);
  const clearRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (props.clearSignal && props.clearSignal > 0) {
      clearRef.current?.();
    }
  }, [props.clearSignal]);

  const handleFileChange = useCallback(
    (details: { acceptedFiles: File[] }) => {
      // Only valid save files (0000-0015 + slot_ metadata) directly in the folder
      const filtered = details.acceptedFiles.filter((file) => {
        if (!isValidSaveFile(file.name)) return false;
        const rel = (file as any).webkitRelativePath || file.name;
        // "folder/file.bin" = 2 segments, "file.bin" = 1 segment (no subdirs)
        return rel.split("/").length <= 2;
      });

      if (filtered.length === 0) return;

      setRootFiles(filtered);

      const collected: SaveFolderFile[] = filtered.map((file) => ({
        file,
        relativePath: (file as any).webkitRelativePath || file.name,
      }));
      props.onFolderSelected(collected);

      const saveNames = collected.filter((f) => isSaveFile(f.file.name)).map((f) => f.file.name);
      setSelected(saveNames);
      props.onSelectedChange?.(new Set(saveNames));
    },
    [props.onFolderSelected, props.onSelectedChange],
  );

  const toggleSave = useCallback(
    (filename: string) => {
      setSelected((prev) => {
        const next = prev.includes(filename)
          ? prev.filter((f) => f !== filename)
          : [...prev, filename];
        props.onSelectedChange?.(new Set(next));
        return next;
      });
    },
    [props.onSelectedChange],
  );

  const toggleAll = useCallback(
    (allSaveNames: string[]) => {
      setSelected((prev) => {
        const next = prev.length !== allSaveNames.length ? allSaveNames : [];
        props.onSelectedChange?.(new Set(next));
        return next;
      });
    },
    [props.onSelectedChange],
  );

  const saveFiles = rootFiles.filter((f) => isSaveFile(f.name));

  return (
    <FileUpload directory maxFiles={64} onFileChange={handleFileChange} className="w-full">
      <ClearWrapper
        onClear={props.onClear}
        setRootFiles={setRootFiles}
        setSelected={setSelected}
        onSelectedChange={props.onSelectedChange}
        clearRef={clearRef}
      >
        {saveFiles.length === 0 && (
          <FileUploadDropzone>
            <FileUploadDropzoneIcon />
            <FileUploadTitle>{props.label ?? "Select PC / Switch save folder"}</FileUploadTitle>
            <FileUploadDescription>Drag a folder here, or click to browse</FileUploadDescription>
          </FileUploadDropzone>
        )}
        {saveFiles.length > 0 && (
          <SaveList
            fileMeta={props.fileMeta}
            selected={selected}
            onToggleSave={toggleSave}
            onToggleAll={toggleAll}
            header={props.header}
            saveFiles={saveFiles}
          />
        )}
      </ClearWrapper>
    </FileUpload>
  );
}

function ClearWrapper({
  children,
  onClear,
  setRootFiles,
  setSelected,
  onSelectedChange,
  clearRef,
}: {
  children: React.ReactNode;
  onClear?: () => void;
  setRootFiles: React.Dispatch<React.SetStateAction<File[]>>;
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  onSelectedChange?: (selectedFilenames: Set<string>) => void;
  clearRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const fileUpload = useFileUpload();

  const clear = useCallback(() => {
    fileUpload.clearFiles();
    setRootFiles([]);
    setSelected([]);
    onClear?.();
    onSelectedChange?.(new Set());
  }, [fileUpload, onClear, onSelectedChange, setRootFiles, setSelected]);

  useEffect(() => {
    if (clearRef) clearRef.current = clear;
  }, [clear, clearRef]);

  return <ClearContext.Provider value={clear}>{children}</ClearContext.Provider>;
}

const ClearContext = createContext<() => void>(() => {});

function SaveList({
  fileMeta,
  selected,
  onToggleSave,
  onToggleAll,
  header,
  saveFiles,
}: {
  fileMeta?: Map<string, { playerName: string; playtime: string }>;
  selected: string[];
  onToggleSave: (filename: string) => void;
  onToggleAll: (allSaveNames: string[]) => void;
  header?: React.ReactNode;
  saveFiles: File[];
}) {
  const clear = useContext(ClearContext);
  const selectAllState: boolean | "indeterminate" =
    selected.length === saveFiles.length ? true : selected.length === 0 ? false : "indeterminate";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        {header}
        <div className="flex items-center gap-1">
          <label className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer">
            <Checkbox
              checked={selectAllState}
              onCheckedChange={(details) => {
                if (details.checked) onToggleAll(saveFiles.map((f) => f.name));
                else onToggleAll([]);
              }}
            />
            {selected.length}/{saveFiles.length} selected
          </label>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={clear}
          >
            <X className="h-3 w-3" /> Clear
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {saveFiles.slice(0, 50).map((f, i) => {
          const meta = fileMeta?.get(f.name);
          const num = parseInt(f.name.replace(".bin", ""));
          const label = num === 0 ? "Auto Save" : `Slot ${num}`;
          const isSelected = selected.includes(f.name);

          return (
            <Item
              key={i}
              variant={isSelected ? "outline" : "muted"}
              className="cursor-pointer transition-colors hover:bg-accent [--space:--spacing(2.5)]"
              onClick={() => onToggleSave(f.name)}
            >
              <ItemMedia>
                <Checkbox
                  checked={isSelected}
                  className="pointer-events-none"
                  onCheckedChange={() => onToggleSave(f.name)}
                />
              </ItemMedia>
              <ItemContent>
                <ItemTitle className="text-xs">{label}</ItemTitle>
                {meta && (
                  <ItemDescription className="text-xs">
                    {meta.playerName} · {meta.playtime}
                  </ItemDescription>
                )}
              </ItemContent>
              <ItemActions>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {(f.size / 1024 / 1024).toFixed(2)} MB
                </span>
              </ItemActions>
            </Item>
          );
        })}
        {saveFiles.length > 50 && (
          <div className="text-xs italic text-muted-foreground px-2.5">
            …and {saveFiles.length - 50} more
          </div>
        )}
      </div>
    </div>
  );
}
