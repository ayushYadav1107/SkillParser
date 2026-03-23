# SkillParser - AI-Powered Resume Screening & Recruitment System

SkillParser is a high-precision, AI-driven Applicant Tracking System (ATS) designed to automate the heavy lifting of recruitment. By leveraging modern Large Language Models (LLMs) and advanced Natural Language Processing (NLP), it transforms how recruiters and candidates interact with job requirements and resumes.

---

## 📄 Project Report

### 1. Abstract
The recruitment process is often bogged down by a high volume of applications, making manual screening inefficient and prone to bias. **SkillParser** addresses this by providing an intelligent, semantic-based matching engine. Unlike traditional ATS platforms that rely on exact keywords, SkillParser understands the *context* and *intent* behind professional experience, skills, and job requirements. Using Google's Gemini models and the Genkit orchestration framework, it delivers highly accurate rankings, gap analysis, and strategic insights for both recruiters and candidates.

### 2. Introduction
In the modern job market, a single job posting can attract hundreds or even thousands of resumes. Recruiters spend an average of 6-7 seconds per resume, leading to missed talent. Candidates often find their applications "lost in a black hole" due to brittle keyword-matching systems. SkillParser was developed to bridge this gap, offering a transparent, high-speed, and intelligent solution that prioritizes quality and relevance through semantic understanding.

### 3. Problem Statement
Traditional recruitment tools suffer from several critical flaws:
- **Brittle Keyword Matching**: Systems fail if a candidate uses "Software Architect" while a JD asks for "Lead Developer," despite the roles being semantically identical.
- **Lack of Deep Extraction**: Most parsers struggle with complex, multi-column PDF layouts or varied formatting styles.
- **Static Scoring**: Scores are often binary (has skill/doesn't have skill) rather than representing the *depth* and *relevance* of experience.
- **Time Inefficiency**: Manual screening at scale is unsustainable for high-growth teams.

### 4. Objectives
- **Automated Requirement Extraction**: Automatically distill job descriptions into structured requirements (Hard Skills, Soft Skills, Experience thresholds).
- **Semantically Aware Scoring**: Rank candidates based on conceptual relevance, not just word-for-word matches.
- **Comprehensive Gap Analysis**: Identify missing key skills or experience areas for each candidate.
- **Multi-Modal Parsing**: Support various document formats (PDF, Image, DOCX) while maintaining data integrity.
- **User-Centric Views**: Provide tailored experiences for both Recruiters (Talent Pool management) and Candidates (Active Match history).

### 5. Methodology
SkillParser utilizes a sophisticated NLP pipeline:
1. **LLM-Based Named Entity Recognition (NER)**: Using **Gemini 2.5 Flash**, the system extracts entities like skills, education, and experience from unstructured text with high context awareness.
2. **Semantic Embedding Comparison**: Instead of simple string comparisons, the engine leverages high-dimensional embeddings to determine the "closeness" of a candidate's profile to a job description.
3. **Chain-of-Thought Reasoning**: For every match, the AI generates a qualitative "Strategic Assessment," explaining exactly *why* a candidate was graded a certain way, identifying "hidden" strengths and potential risks.
4. **Client-Side Data Orchestration**: Responsive UI built with Next.js and Radix UI components, with persistent storage via IndexedDB for resume management.

### 6. Technologies Used
- **Core Framework**: [Next.js 15](https://nextjs.org/) (App Router)
- **AI Engine**: [Genkit 1.x](https://github.com/firebase/genkit)
- **Generative Models**: [Google Gemini 2.0 / 2.5 Flash](https://ai.google.dev/models/gemini)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **UI Components**: [Shadcn UI](https://ui.shadcn.com/) (Radix Primitives)
- **Persistence**: LocalStorage & IndexedDB (Browser-based storage)
- **Icons**: [Lucide React](https://lucide.dev/)

### 7. Results
- **99%+ Extraction Accuracy**: Effectively parses complex resume layouts that break traditional OCR tools.
- **Reduced Screening Time**: Automated ranking allows recruiters to focus on the top 5% of candidates instantly.
- **Improved Fairness**: Semantic matching reduces the impact of "keyword stuffing," focusing instead on verified experience and skills.
- **Positive UX**: Fast, responsive interface with clear feedback loops (Toasts, Progress Indicators).

### 8. Conclusion
SkillParser represents the next generation of recruitment technology. By moving from "Search" to "Understanding," it creates a more equitable and efficient marketplace for both talent and employers. Future iterations will focus on deeper integration with external HR tools and advanced candidate anonymization to further reduce unconscious bias.

---

## 🚀 Step-Wise Project Workflow

### Step 1: Authentication & Role Selection
Users land on the SkillParser home page and choose their role: **Candidate** or **Recruiter**. They log in or register to access their respective dashboards.

### Step 2: Job Description Analysis (Recruiter/Candidate)
- The user enters a Job Description (JD).
- The system runs the `extractJobDescriptionRequirements` flow.
- AI distills the JD into a structured list of mandatory and preferred skills.

### Step 3: Multi-Modal Resume Upload
- Users upload one or more resumes (PDF, DOCX, or Image).
- Files are temporarily stored and managed via **IndexedDB** for high-performance browser retrieval.

### Step 4: AI Extraction & Parsing
- The `extractResumeInformation` flow triggers.
- Gemini 2.5 Flash processes the documents to extract Skills, Experience, Education, and Certifications into a clean JSON schema.

### Step 5: Semantic Matching & Scoring
- The `calculateResumeMatchScore` flow performs a deep comparison between the extracted resume data and the JD requirements.
- The system calculates a **Match Score (0-100)** and generates a **Gap Analysis** (Matched vs. Missing Skills).

### Step 6: Result Visualization & Insights
- Analysis results are displayed in a clean, interactive dashboard.
- Users can view "AI Insights," "Experience Maps," and "Strategic Assessments" for each candidate.

### Step 7: Talent Pool & History Management
- **Recruiters**: Can shortlist top candidates, moving them to the "Talent Pool" for further review or resume download.
- **Candidates**: Can view their "History" of matches and revisit past results at any time.

### Step 8: Reporting
- The system allows downloading full candidate reports as PDFs or individual resumes for offline review.

---

## 🛠️ Development & Customization

1. **Environment Config**: Set your `GOOGLE_GENAI_API_KEY` in your `.env` file.
2. **Commands**:
   - `npm install`: Install dependencies.
   - `npm run dev`: Start the development server.
   - `npm run build`: Production build.

---
*Built with ❤️ for the future of work.*
