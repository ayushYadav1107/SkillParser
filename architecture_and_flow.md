# System Architecture and Flow Diagrams

The following sections detail the system architecture and processing flows designed for the AI-Powered Resume Matcher project. These diagrams and accompanying explanations can be directly added to your project report.

## 1. High-Level System Architecture

The project is structured around a modern web stack, utilizing Next.js for both the client and server components, IndexedDB for robust client-side storage, and Google Genkit for LLM-based capabilities.

```mermaid
graph TD
    subgraph Client [Client-Side Browser]
        UI[Next.js React UI]
        DB[(IndexedDB)]
        UI -->|Save/Retrieve Large Files| DB
        UI -->|Trigger AI Actions| SA
    end

    subgraph Server [Next.js Server Actions]
        SA[Server Actions]
        Genkit[Google Genkit Provider]
        SA -->|Invoke AI Flows| Genkit
    end

    subgraph AI [Google AI Services]
        LLM[Gemini 2.5 Flash / 1.5 Pro]
        Genkit -->|Prompt Execution| LLM
        LLM -->|Structured JSON Output| Genkit
    end
    
    UI -->|Displays Results| UI
```

### Description
The High-Level Architecture separates concerns into a robust client interface and an AI-driven backend layer.
- **Client layer**: Next.js handles the front-end rendering. Because resumes can be large binary files (PDFs, DOCX), storing them in `localStorage` is not feasible. The architecture elegantly solves this by utilizing **IndexedDB** as an asynchronous local storage engine for candidate resumes.
- **Server Actions**: Instead of traditional REST endpoints, Next.js Server Actions establish a direct, secure bridge from the client state to the backend logic.
- **Genkit AI**: The backend utilizes the Genkit framework to define declarative "flows" and "prompts." We leverage schema-enforced JSON outputs (via `zod`) to ensure that the generative model (Gemini) responds with strictly formatted candidate data instead of raw text.

---

## 2. Resume Processing & Matching Flow

This sequence diagram illustrates the step-by-step lifecycle of parsing a resume and calculating a match score against a job description.

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant IndexedDB
    participant Server Flow
    participant Gemini AI

    User->>Frontend: Upload Resume & Input Job Description
    Frontend->>IndexedDB: saveResumeFile(id, fileBlob)
    Frontend->>Server Flow: call extractJobDescription()
    Server Flow->>Gemini AI: extract requirements constraints
    Gemini AI-->>Server Flow: return Structured Job Data
    
    Frontend->>Server Flow: call extractResumeInformation()
    Server Flow->>Gemini AI: prompt candidate details
    Gemini AI-->>Server Flow: return Parsed Extraction JSON
    
    Frontend->>Server Flow: call calculateResumeMatchScore(resumeText, jobText)
    Server Flow->>Gemini AI: Evaluate overlap, missing skills, HR criteria
    Gemini AI-->>Server Flow: Return Match Score (0-100) & Explanations JSON
    Server Flow-->>Frontend: Display Candidate Match Results
    Frontend-->>User: Render Dashboard Analytics
```

### Description
The Resume Matching flow is an asynchronous pipeline orchestrated to maintain UI responsiveness:
1. The user provides a resume file and a job description.
2. The file is temporarily cached in IndexedDB. 
3. The system fires off modular AI flows: one dedicated to parsing the requirements of the job description, and one parsing the candidate's skills, work history, and education.
4. Finally, the "Calculation" flow fuses both parsed datasets. The model acts as an expert HR recruiter, generating a definitive score (0-100), explicitly identifying matched skills, and crucially, pointing out missing skills.

---

## 3. Resilient AI Execution with Self-Healing Fallback

A critical feature of production-ready AI applications is handling rate limits and API service disruptions. 

```mermaid
stateDiagram-v2
    [*] --> Gemini2_5_Flash
    
    state Gemini2_5_Flash {
        Attempt1 --> Attempt2: Error/Rate Limit
        Attempt2 --> Attempt3: Error/Rate Limit
    }
    
    Gemini2_5_Flash --> Gemini1_5_Flash: All 3 Prompts Fail
    
    state Gemini1_5_Flash {
        FlashAttempt1 --> FlashAttempt2: Error/Rate Limit
    }
    
    Gemini1_5_Flash --> Gemini1_5_Pro: Exhausted
    Gemini1_5_Pro --> [*]: Success Output
    Gemini1_5_Pro --> Failure: Last Error
    Failure --> [*]: Throw Exception Message
```

### Description
Because the application relies heavily on third-party AI APIs (Google Genkit), it implements an **Exponential Backoff and Fallback** pattern.
- If the primary model (`gemini-2.5-flash`) faces a 429 Rate Limit or transient failure, the system automatically waits.
- The wait time grows exponentially between retries.
- If the primary model exhausts its three attempts, the system dynamically swaps the engine to `googleai/gemini-1.5-flash`, and subsequently `gemini-1.5-pro` as an ultimate safety net. This ensures high availability and robustness for end-users, guaranteeing that no resume analysis fails silently.
