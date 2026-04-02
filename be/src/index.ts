require("dotenv").config();
import express from "express";
import { GoogleGenAI } from "@google/genai";
import { BASE_PROMPT, getSystemPrompt } from "./prompts";
import { basePrompt as nodeBasePrompt } from "./defaults/node";
import { basePrompt as reactBasePrompt } from "./defaults/react";
import cors from "cors";

if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
}

// ✅ NEW SDK
const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

const app = express();
app.use(cors());
app.use(express.json());

app.post("/template", async(req: any, res: any) => {
    const prompt = req.body.prompt;
    console.log(prompt)

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
            systemInstruction:
                "Return either node or react based on what do you think this project should be. Only return a single word either 'node' or 'react'. Do not return anything extra",
        },
    });

    const answer = response.text!.trim().toLowerCase(); // react or node
    console.log(answer)

    if (answer === "react") {
        return res.json({
            prompts: [
                BASE_PROMPT,
                `Here is an artifact that contains all files of the project visible to you.\nConsider the contents of ALL files in the project.\n\n${reactBasePrompt}\n\nHere is a list of files that exist on the file system but are not being shown to you:\n\n  - .gitignore\n  - package-lock.json\n`,
            ],
            uiPrompts: [reactBasePrompt],
        });
    }

    if (answer === "node") {
        return res.json({
            prompts: [
                `Here is an artifact that contains all files of the project visible to you.\nConsider the contents of ALL files in the project.\n\n${nodeBasePrompt}\n\nHere is a list of files that exist on the file system but are not being shown to you:\n\n  - .gitignore\n  - package-lock.json\n`,
            ],
            uiPrompts: [nodeBasePrompt],
        });
    }

    return res.status(403).json({ message: "You cant access this" });
});

app.post("/chat", async (req, res) => {
    const messages = req.body.messages;

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: messages.map((m: any) => m.content).join("\n"),
        config: {
            systemInstruction: getSystemPrompt(),
        },
    });

    console.log(response);
    console.log(response.text)
    res.json({
        response: response.text,
    });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server running on PORT ${PORT}`));