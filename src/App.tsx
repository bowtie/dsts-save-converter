import { useState, useEffect, useCallback } from "react";
import { SaveFolderUpload, type SaveFolderFile } from "./FileUploads";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Toaster, toast } from "@/components/ui/toast";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { DownloadIcon, LoaderIcon, TriangleAlertIcon } from "lucide-react";
import {
  convertPcToSwitch,
  detectPlatform,
  extractSaveMeta,
  loadSwitchRefB64,
  type Platform,
  type ConversionResult,
} from "./converter";
import { selectConversionFiles } from "./file-selection";

export default function App() {
  const [files, setFiles] = useState<SaveFolderFile[]>([]);
  const [selectedSaves, setSelectedSaves] = useState<Set<string>>(new Set());
  const [platform, setPlatform] = useState<Platform>("unknown");
  const [fileMeta, setFileMeta] = useState<Map<string, { playerName: string; playtime: string }>>(
    new Map(),
  );
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clearSignal, setClearSignal] = useState(0);

  useEffect(() => {
    loadSwitchRefB64().catch((err) => console.error("Failed to load Switch reference:", err));
  }, []);

  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl]);

  const handleFolderSelected = useCallback(async (selected: SaveFolderFile[]) => {
    setFiles(selected);
    setFileMeta(new Map());
    const rawFiles = selected.map((f) => f.file);
    const detected = await detectPlatform(rawFiles);
    setPlatform(detected);
    setDownloadUrl(null);

    if (detected === "unknown") {
      const hasBins = rawFiles.some((f) => f.name.endsWith(".bin"));
      setClearSignal((s) => s + 1);
      toast.create({
        type: "error",
        title: hasBins ? "Couldn't identify these saves" : "No save files found",
        description: hasBins
          ? "Make sure all .bin files are from the same platform."
          : "Select the save folder directly, not a parent folder.",
      });
      return;
    }

    if (detected === "switch") {
      setClearSignal((s) => s + 1);
      toast.create({
        type: "error",
        title: "These are Switch saves",
        description: "Only PC to Switch is supported for now, Switch to PC is coming later.",
      });
      return;
    }

    // Extract player name + playtime from slot_ metadata files
    try {
      const meta = await extractSaveMeta(rawFiles);
      const map = new Map<string, { playerName: string; playtime: string }>();
      for (const m of meta) map.set(m.filename, { playerName: m.playerName, playtime: m.playtime });
      setFileMeta(map);
    } catch (err) {
      console.error("Failed to extract save metadata:", err);
    }
  }, []);

  const handleSelectedChange = useCallback((s: Set<string>) => {
    setSelectedSaves(s);
  }, []);

  const handleClear = useCallback(() => {
    setFiles([]);
    setFileMeta(new Map());
    setSelectedSaves(new Set());
    setPlatform("unknown");
    setDownloadUrl(null);
  }, []);

  const downloadResult = useCallback(async (result: ConversionResult, filename: string) => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    for (const [name, data] of result.files) zip.file(name, data);
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    setDownloadUrl(url);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }, []);

  const handleConvert = async () => {
    if (files.length === 0) {
      toast.create({ type: "error", title: "Select a save folder first." });
      return;
    }
    if (selectedSaves.size === 0) {
      toast.create({ type: "error", title: "Select at least one save to convert." });
      return;
    }

    const rawFiles = selectConversionFiles(
      files.map((entry) => entry.file),
      selectedSaves,
    );

    if (platform === "pc") {
      setBusy(true);
      try {
        const result = await convertPcToSwitch(rawFiles);
        toast.create({
          type: "success",
          title: `Converted ${selectedSaves.size} save(s) successfully!`,
        });
        await downloadResult(result, "switch-save.zip");
      } catch (err) {
        toast.create({ type: "error", title: `Error: ${(err as Error).message}` });
      } finally {
        setBusy(false);
      }
    } else {
      toast.create({
        type: "error",
        title: "Only PC to Switch is supported for now, Switch to PC is coming later.",
      });
    }
  };

  const disabledReason = busy
    ? null
    : platform !== "pc"
      ? "Upload a PC save folder first"
      : selectedSaves.size === 0
        ? "Select at least one save"
        : null;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="mx-auto w-full max-w-lg px-6 py-10">
        {/* GitHub corner */}
        <a
          href="https://github.com/bowtie/dsts-save-converter"
          target="_blank"
          rel="noopener noreferrer"
          className="github-corner fixed top-0 right-0"
          aria-label="View source on GitHub"
        >
          <svg
            width="80"
            height="80"
            viewBox="0 0 250 250"
            style={{ fill: "var(--color-chart-4)", color: "var(--color-primary-foreground)" }}
            aria-hidden="true"
          >
            <path d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z" />
            <path
              d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2"
              fill="currentColor"
              className="octo-arm"
              style={{ transformOrigin: "130px 106px" }}
            />
            <path
              d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.7 141.6,141.9 141.8,141.8 Z"
              fill="currentColor"
              className="octo-body"
            />
          </svg>
        </a>

        {/* Header */}
        <header className="mb-6 flex items-center gap-4">
          <div className="flex size-20 shrink-0 items-center justify-center rounded-full bg-primary/10 outline-1 outline-white/10 select-none">
            <img src="./calumon.webp" alt="Calumon" width={70} height={55} draggable={false} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-tight tracking-tight text-foreground">
              DSTS Save Converter
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Convert Digimon Story: Time Stranger saves from PC to Nintendo Switch. Nothing leaves
              your browser.
            </p>
          </div>
        </header>

        {/* Experimental warning */}
        <Alert variant="warning" className="mb-6">
          <TriangleAlertIcon />
          <AlertTitle>Heads up, this is experimental</AlertTitle>
          <AlertDescription>
            <span>
              The full extent of what's covered and what might break isn't known yet. Back up your
              save before using it!
            </span>
          </AlertDescription>
        </Alert>

        {/* FAQ */}
        <div className="mb-6">
          <Accordion>
            <AccordionItem value="how">
              <AccordionTrigger className="py-3">How does it work?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground pb-3">
                Just drop your PC save folder and hit convert. Everything runs right in your
                browser, nothing gets uploaded anywhere.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="costume">
              <AccordionTrigger className="py-3">Why did my outfit reset?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground pb-3">
                PC and Switch store outfit data differently, so we swap in a fresh default outfit to
                make sure costumes work properly on Switch. Your old PC outfit won't carry over, but
                you can change costumes freely in-game once you're loaded in.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="issues">
              <AccordionTrigger className="py-3">Experiencing issues?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground pb-3">
                The save file differences between PC and Switch are still being figured out, so it's
                not clear yet what carries over properly and what doesn't. Some PC data might not
                work correctly on Switch. If you run into anything weird,{" "}
                <a
                  href="https://github.com/bowtie/dsts-save-converter/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  let me know
                </a>
                .
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        {/* Converter */}
        <Card className="gap-0 rounded-xl py-0">
          <CardContent className="p-3 space-y-3">
            {/* Folder upload */}
            <SaveFolderUpload
              label="PC save folder"
              onFolderSelected={handleFolderSelected}
              onSelectedChange={handleSelectedChange}
              onClear={handleClear}
              clearSignal={clearSignal}
              fileMeta={fileMeta}
              header={
                platform === "pc" && files.length > 0 ? (
                  <Badge className="bg-primary text-primary-foreground">PC to Switch</Badge>
                ) : null
              }
            />

            {/* Convert button */}
            {disabledReason ? (
              <Tooltip positioning={{ placement: "bottom", gutter: 8 }}>
                <TooltipTrigger asChild>
                  <span className="block w-full">
                    <Button disabled className="w-full h-10 rounded-lg text-sm">
                      Convert
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{disabledReason}</TooltipContent>
              </Tooltip>
            ) : (
              <Button
                onClick={handleConvert}
                disabled={busy}
                className="w-full h-10 rounded-lg text-sm"
              >
                {busy ? (
                  <>
                    <LoaderIcon className="animate-spin" />
                    Converting...
                  </>
                ) : (
                  <>Convert</>
                )}
              </Button>
            )}

            {downloadUrl && (
              <Button
                variant="outline"
                className="w-full h-10 rounded-lg text-sm"
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = downloadUrl;
                  a.download = "switch-save.zip";
                  a.click();
                }}
              >
                <DownloadIcon />
                Download ZIP
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <Toaster />
    </div>
  );
}
