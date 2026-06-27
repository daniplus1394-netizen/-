import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

// Load environment variables
dotenv.config();

const PORT = 3000;

// Initialize Gemini SDK with server-side key
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Enforce daily limit of 10 requests per user IP address
interface IpUsage {
  count: number;
  lastResetDate: string; // YYYY-MM-DD
}
const ipUsageMap = new Map<string, IpUsage>();

function checkAndEnforceIpLimit(ip: string): { allowed: boolean; remaining: number } {
  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  let usage = ipUsageMap.get(ip);

  if (!usage) {
    usage = { count: 0, lastResetDate: todayStr };
    ipUsageMap.set(ip, usage);
  } else if (usage.lastResetDate !== todayStr) {
    usage.count = 0;
    usage.lastResetDate = todayStr;
  }

  if (usage.count >= 10) {
    return { allowed: false, remaining: 0 };
  }

  usage.count += 1;
  return { allowed: true, remaining: 10 - usage.count };
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // Shia AI Marja' al-Taqlid Endpoint
  app.post("/api/marja", async (req, res) => {
    try {
      const { question, preferredMarja, language } = req.body;

      if (!question || question.trim() === "") {
        return res.status(400).json({ error: "پرسش نمی‌تواند خالی باشد." });
      }

      // Enforce IP limit
      const clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "anonymous";
      const limitResult = checkAndEnforceIpLimit(clientIp);

      if (!limitResult.allowed) {
        return res.status(429).json({
          error: language === "fa" ? "شما به حد مجاز ۱۰ پرسش روزانه خود رسیده‌اید. فردا دوباره مراجعه فرمایید." :
                 "You have reached your daily limit of 10 questions. Please try again tomorrow.",
          remaining: 0
        });
      }

      // Shia Marja' System Prompt
      const marjaSelectionText = preferredMarja && preferredMarja !== "general"
        ? `ترجیحاً مطابق فتاوا و توضیح‌المسائل حضرت آیت‌الله العظمی ${preferredMarja} پاسخ دهید.`
        : "مطابق با توضیح‌المسائل و استفتائات مراجع تراز اول شیعه اثنی‌عشری (مانند آیات عظام سیستانی، خامنه‌ای، بهجت و مکارم شیرازی) پاسخ دهید.";

      const systemInstruction = `
        شما یک هوش مصنوعی کارشناس، متین و آگاه به احکام شرعی شیعه دوازده‌امامی (مرجع تقلید استفتائات و معارف اسلامی) هستید.
        نام شما «هوش‌افزار پاسخگوی احکام شرعی قمر بنی‌هاشم (ع)» است.
        هدف شما پاسخگویی به سوالات شرعی، احکام عملی (طهارت، نماز، روزه، خمس، زکات، مسائل مالی، ازدواج، اخلاق و معارف اسلامی) کاربران با کمال احترام و مستدل است.

        دستورالعمل‌ها:
        ۱. همواره لحنی محترمانه، فقیهانه، آرامش‌بخش و مذهبی داشته باشید.
        ۲. پاسخ‌ها را دسته‌بندی و شماره‌گذاری کنید تا بسیار خوانا و روان باشند.
        ۳. در صورت امکان، آیات قرآن یا روایات مستند مرتبط را ذکر کنید.
        ۴. فتاوای مراجع شیعه را به درستی تبیین کنید. ${marjaSelectionText}
        ۵. پاسخ‌ها را به همان زبانی که کاربر پرسیده (فارسی، عربی، انگلیسی، ترکی آذربایجانی، یا اردو) ارائه دهید.
        ۶. در انتهای پاسخ ذکر کنید که این پاسخ توسط هوش مصنوعی بر اساس فتاوای مراجع استخراج شده و برای اطمینان بیشتر، رجوع به دفتر مرجع خود پسندیده است.
      `;

      // Call Gemini API
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: question,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.2, // Low temperature for consistent theological accuracy
        }
      });

      const responseText = response.text || "خطایی در استخراج پاسخ رخ داده است.";

      return res.json({
        answer: responseText,
        remaining: limitResult.remaining
      });

    } catch (error: any) {
      console.error("Error calling Gemini API:", error);
      return res.status(500).json({
        error: "در حال حاضر ارتباط با سرور فقهی برقرار نشد. لطفاً چند لحظه دیگر تلاش فرمایید."
      });
    }
  });

  // Mount Vite middleware in development, serve static files in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Full-stack server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
