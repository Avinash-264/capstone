import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { StepsList } from "../components/StepsList";
import { FileExplorer } from "../components/FileExplorer";
import { TabView } from "../components/TabView";
import { CodeEditor } from "../components/CodeEditor";
import { PreviewFrame } from "../components/PreviewFrame";
import { Step, FileItem, StepType } from "../types";
import axios from "axios";
import { BACKEND_URL } from "../config";
import { parseXml } from "../steps";
import { useWebContainer } from "../hooks/useWebContainer";
import { FileNode } from "@webcontainer/api";
import { Loader } from "../components/Loader";
import JSZip from "jszip";
import { saveAs } from "file-saver";

const MOCK_FILE_CONTENT = `// This is a sample file content
import React from 'react';

function Component() {
  return <div>Hello World</div>;
}

export default Component;`;

export function Builder() {
  const location = useLocation();
  const { prompt } = location.state as { prompt: string };
  const [userPrompt, setPrompt] = useState("");
  const [llmMessages, setLlmMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [templateSet, setTemplateSet] = useState(false);
  const webcontainer = useWebContainer();

  const [currentStep, setCurrentStep] = useState(1);
  const [activeTab, setActiveTab] = useState<"code" | "preview">("code");
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);

  const [steps, setSteps] = useState<Step[]>([]);

  const [files, setFiles] = useState<FileItem[]>([]);

  useEffect(() => {
    let originalFiles = [...files];
    let updateHappened = false;
    steps
      .filter(({ status }) => status === "pending")
      .map((step) => {
        updateHappened = true;
        if (step?.type === StepType.CreateFile) {
          let parsedPath = step.path?.split("/") ?? []; // ["src", "components", "App.tsx"]
          let currentFileStructure = [...originalFiles]; // {}
          let finalAnswerRef = currentFileStructure;

          let currentFolder = "";
          while (parsedPath.length) {
            currentFolder = `${currentFolder}/${parsedPath[0]}`;
            let currentFolderName = parsedPath[0];
            parsedPath = parsedPath.slice(1);

            if (!parsedPath.length) {
              // final file
              let file = currentFileStructure.find(
                (x) => x.path === currentFolder,
              );
              if (!file) {
                currentFileStructure.push({
                  name: currentFolderName,
                  type: "file",
                  path: currentFolder,
                  content: step.code,
                });
              } else {
                file.content = step.code;
              }
            } else {
              /// in a folder
              let folder = currentFileStructure.find(
                (x) => x.path === currentFolder,
              );
              if (!folder) {
                // create the folder
                currentFileStructure.push({
                  name: currentFolderName,
                  type: "folder",
                  path: currentFolder,
                  children: [],
                });
              }

              currentFileStructure = currentFileStructure.find(
                (x) => x.path === currentFolder,
              )!.children!;
            }
          }
          originalFiles = finalAnswerRef;
        }
      });

    if (updateHappened) {
      setFiles(originalFiles);
      setSteps((steps) =>
        steps.map((s: Step) => {
          return {
            ...s,
            status: "completed",
          };
        }),
      );
    }
    console.log(files);
  }, [steps, files]);

  useEffect(() => {
    const createMountStructure = (files: FileItem[]): Record<string, any> => {
      const mountStructure: Record<string, any> = {};

      const processFile = (file: FileItem, isRootFolder: boolean) => {
        if (file.type === "folder") {
          // For folders, create a directory entry
          mountStructure[file.name] = {
            directory: file.children
              ? Object.fromEntries(
                  file.children.map((child) => [
                    child.name,
                    processFile(child, false),
                  ]),
                )
              : {},
          };
        } else if (file.type === "file") {
          if (isRootFolder) {
            mountStructure[file.name] = {
              file: {
                contents: file.content || "",
              },
            };
          } else {
            // For files, create a file entry with contents
            return {
              file: {
                contents: file.content || "",
              },
            };
          }
        }

        return mountStructure[file.name];
      };

      // Process each top-level file/folder
      files.forEach((file) => processFile(file, true));

      return mountStructure;
    };

    const mountStructure = createMountStructure(files);

    // Mount the structure if WebContainer is available
    console.log(mountStructure);
    webcontainer?.mount(mountStructure);
  }, [files, webcontainer]);

  async function init() {
    const response = await axios.post(`${BACKEND_URL}/template`, {
      prompt: prompt.trim(),
    });
    setTemplateSet(true);

    const { prompts, uiPrompts } = response.data;

    // setSteps(parseXml(uiPrompts[0]).map((x: Step) => ({
    //   ...x,
    //   status: "pending"
    // })));
    setSteps(
      parseXml(uiPrompts[0]).map((x: Step) => ({
        ...x,
        id: crypto.randomUUID(), // ✅ FIX
        status: "pending" as const,
      })),
    );

    setLoading(true);
    const stepsResponse = await axios.post(`${BACKEND_URL}/chat`, {
      messages: [...prompts, prompt].map((content) => ({
        role: "user",
        content,
      })),
    });

    setLoading(false);

    // setSteps(s => [...s, ...parseXml(stepsResponse.data.response).map(x => ({
    //   ...x,
    //   status: "pending" as "pending"
    // }))]);

    setSteps((s) => [
      ...s,
      ...parseXml(stepsResponse.data.response).map((x) => ({
        ...x,
        id: crypto.randomUUID(), // ✅ FIX
        status: "pending" as const,
      })),
    ]);

    setLlmMessages(
      [...prompts, prompt].map((content) => ({
        role: "user",
        content,
      })),
    );

    setLlmMessages((x) => [
      ...x,
      { role: "assistant", content: stepsResponse.data.response },
    ]);
  }

  useEffect(() => {
    init();
  }, []);

  const downloadProject = async () => {
    if (!files.length) {
      alert("No project generated yet");
      return;
    }

    const zip = new JSZip();

    const addFiles = (items: FileItem[], folder: JSZip) => {
      items.forEach((item) => {
        if (item.type === "folder") {
          const newFolder = folder.folder(item.name);
          if (item.children && newFolder) {
            addFiles(item.children, newFolder);
          }
        } else {
          folder.file(item.name, item.content || "");
        }
      });
    };

    addFiles(files, zip);

    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, "text-to-app.zip");
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <header className="bg-gray-800/80 backdrop-blur border-b border-gray-700 px-6 py-4 flex items-center justify-between">
        {/* Left side */}
        <div className="flex flex-col">
          <h1 className="text-xl font-semibold text-white tracking-tight">
            TEXT TO APP GENERATOR
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">{prompt}</p>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* Download Button */}
          <button
            onClick={downloadProject}
            className="text-sm bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-md transition shadow"
          >
            Download
          </button>

          {/* Deploy Button */}
          <button
            onClick={() => window.open("https://vercel.com/new", "_blank")}
            className="text-sm bg-purple-500 hover:bg-purple-600 px-3 py-1.5 rounded-md transition shadow"
          >
            Deploy
          </button>

          {/* Status */}
          <span className="text-xs text-gray-400 border border-gray-600 px-2 py-1 rounded-md">
            Live Build
          </span>

          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <div className="h-full grid grid-cols-4 gap-6 p-6">
          <div className="col-span-1 space-y-6 h-full">
            <div>
              <div className="h-[70vh] overflow-hidden">
                <StepsList
                  steps={steps}
                  currentStep={currentStep}
                  onStepClick={setCurrentStep}
                />
              </div>
              <div>
                <div className="mt-3">
                  {(loading || !templateSet) && <Loader />}

                  {!(loading || !templateSet) && (
                    <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-2 py-2">
                      <textarea
                        value={userPrompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="Type your message..."
                        rows={2}
                        className="flex-1 bg-transparent text-gray-200 placeholder-gray-500 outline-none resize-none px-2 py-2 min-h-[60px] overflow-hidden"
                      />

                      <button
                        onClick={async () => {
                          const newMessage = {
                            role: "user" as "user",
                            content: userPrompt,
                          };

                          setLoading(true);
                          const stepsResponse = await axios.post(
                            `${BACKEND_URL}/chat`,
                            {
                              messages: [...llmMessages, newMessage],
                            },
                          );
                          setLoading(false);

                          setLlmMessages((x) => [...x, newMessage]);
                          setLlmMessages((x) => [
                            ...x,
                            {
                              role: "assistant",
                              content: stepsResponse.data.response,
                            },
                          ]);

                          setSteps((s) => [
                            ...s,
                            ...parseXml(stepsResponse.data.response).map(
                              (x) => ({
                                ...x,
                                id: crypto.randomUUID(),
                                status: "pending" as const,
                              }),
                            ),
                          ]);
                        }}
                        className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-1.5 rounded-md transition"
                      >
                        Send
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="col-span-1">
            <FileExplorer files={files} onFileSelect={setSelectedFile} />
          </div>
          <div className="col-span-2 bg-gray-900 rounded-lg shadow-lg p-4 h-[calc(100vh-8rem)]">
            <TabView activeTab={activeTab} onTabChange={setActiveTab} />
            <div className="h-[calc(100%-4rem)]">
              {activeTab === "code" ? (
                <CodeEditor file={selectedFile} />
              ) : (
                <PreviewFrame webContainer={webcontainer} files={files} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
