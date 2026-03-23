<<<<<<< HEAD
# SkillParser
=======
# SkillParser - AI-Powered Resume Screening System

SkillParser is a high-precision Applicant Tracking System (ATS) built to automate the heavy lifting of recruitment using modern AI and advanced Natural Language Processing.

## 🚀 Tech Stack

- **Framework**: [Next.js 15](https://nextjs.org/) (App Router)
- **AI Orchestration**: [Genkit 1.x](https://github.com/firebase/genkit)
- **Generative Model**: [Google Gemini 2.5 Flash](https://ai.google.dev/models/gemini)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **UI Components**: [ShadCN UI](https://ui.shadcn.com/)
- **Icons**: [Lucide React](https://lucide.dev/)

## 🧠 NLP & AI Architecture

SkillParser replaces traditional, brittle keyword-matching with a modern LLM-driven NLP pipeline.

### 1. Information Extraction (LLM-based NER)
Instead of using fixed rules (Regex) or small statistical models (spaCy), we use **Gemini 2.5 Flash** for **Named Entity Recognition**. 
- **Context Awareness**: The model distinguishes between "Java" (Programming Language) and "Java" (Island/Coffee) based on surrounding text.
- **Entity Linking**: It automatically links variations like "ML," "Machine Learning," and "Deep Learning" to the same conceptual skill group.

### 2. Semantic Matching vs. Keyword Matching
Traditional ATS systems fail if a resume says "Software Architect" and a JD asks for "Lead Developer." 
- **Vector Space Intuition**: While we don't manually calculate cosine similarity in a local vector DB, we leverage Gemini's internal high-dimensional embeddings to perform **Semantic Comparison**. 
- **Gap Analysis**: The NLP engine identifies "hidden" gaps, such as a candidate having the right tools but lacking the required seniority or industry-specific domain knowledge.

### 3. Reasoning & Strategic Assessment
The system doesn't just return a number. It uses **Chain-of-Thought reasoning** to generate a "Strategic Assessment." This provides recruiters with a qualitative explanation of *why* a candidate scored a certain way, identifying strengths and weaknesses in natural language.

## 🛠️ How It Works

### 1. Job Description (JD) Analysis
When you paste a job description, the `extractJobDescriptionRequirements` flow identifies:
- **Hard Skills**: Specific technical requirements.
- **Soft Skills**: Cultural and interpersonal needs.
- **Thresholds**: Minimum years of experience and education levels.

### 2. Multimodal Resume Extraction
Gemini "reads" the document (PDF/Image) directly to extract structured JSON. It handles complex multi-column layouts that break traditional text-only parsers.

### 3. Semantic Matching Engine
The `calculateResumeMatchScore` flow provides:
- **Match Score (0-100)**: A weighted semantic calculation.
- **Gap Analysis**: Identification of missing skills or experience.

## 🚀 Getting Started

1. Go to the **Screener** page.
2. Paste a Job Description and click **Extract Requirements**.
3. Upload one or more resumes.
4. Watch as the AI parses and ranks candidates in real-time.
>>>>>>> 5f2b2c7 (initial commit)
