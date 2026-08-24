# Mathematical Foundation of NLP & Resume Matching

This section details the mathematical underpinnings of the Resume Parsers, contrasting traditional Information Retrieval (IR) methods with the modern Large Language Model (LLM) embedding strategies utilized in this project.

## 1. Traditional Methods: TF-IDF and Cosine Similarity

Historically, resume matching algorithms relied on **Bag-of-Words (BoW)** models, specifically Term Frequency-Inverse Document Frequency (TF-IDF) coupled with Cosine Similarity. 

### Term Frequency (TF)
TF measures how frequently a term appears in a document (e.g., a resume). Let $t$ be a term (skill) and $d$ be a document:
$$ TF(t, d) = \frac{\text{Number of times } t \text{ appears in } d}{\text{Total number of terms in } d} $$

### Inverse Document Frequency (IDF)
IDF measures the rarity or informativeness of a term across the entire corpus $D$ (all resumes and job descriptions):
$$ IDF(t, D) = \log\left(\frac{N}{|\{d \in D : t \in d\}|}\right) $$
Where $N$ is the total number of documents. Common words like "the" or "and" receive an IDF near zero, while rare skills like "Genkit" receive a higher weight.

### TF-IDF Vector
A document is represented as a high-dimensional sparse vector $\vec{v}_d$, where each dimension corresponds to the TF-IDF score of a specific vocabulary word:
$$ \vec{v}_d = [w_1, w_2, ..., w_V] \text{ where } w_i = TF(t_i, d) \times IDF(t_i, D) $$

### Cosine Similarity for Matching
To find the match between a Resume ($R$) and Job Description ($J$), the system computes the cosine of the angle $\theta$ between their TF-IDF vectors:
$$ \text{Similarity}(R, J) = \cos(\theta) = \frac{\vec{v}_R \cdot \vec{v}_J}{\|\vec{v}_R\| \|\vec{v}_J\|} = \frac{\sum_{i=1}^{V} w_{R,i} w_{J,i}}{\sqrt{\sum_{i=1}^{V} w_{R,i}^2} \sqrt{\sum_{i=1}^{V} w_{J,i}^2}} $$

**Limitations:**
1. **Sparsity & Orthogonality**: If a job description asks for "Next.js" and the resume has "React Framework", the TF-IDF vectors are orthogonal (dot product is 0) because they do not share exact lexemes, completely missing the semantic relationship.
2. **Context Blindness**: "Managed a team of developers" and "Developers managed the team" have the same BoW representation but entirely different meanings.

---

## 2. Modern Approach: Contextual Embeddings (This Project)

Instead of sparse TF-IDF vectors, this project leverages **Google Genkit and the Gemini model (gemini-2.5-flash)**. While not explicitly using a standalone Vector Database, the Gemini LLM internally projects all input text (Prompt + Resume + Job Description) into a continuous, dense vector space (Contextual Embeddings).

### Transformer Attention Mechanism
The core mathematical engine replacing TF-IDF is the **Self-Attention Mechanism**. Given a sequence of tokens mapped to initial dense embeddings $X \in \mathbb{R}^{L \times d_{model}}$, the model projects them into Query ($Q$), Key ($K$), and Value ($V$) matrices:
$$ Q = X W_Q, \quad K = X W_K, \quad V = X W_V $$

The attention weights are calculated as:
$$ \text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V $$

This equation calculates how much "attention" or relevance every word has to every other word in the document. 
- The dot product $QK^T$ calculates semantic alignment between words.
- The $\sqrt{d_k}$ term scales the gradients.
- The `softmax` normalizes weights to a probability distribution.

### Non-Linear Transformations & Deep Layers
Unlike the linear, single-step TF-IDF pipeline, the Gemini model processes these attention outputs through deep Feed-Forward Neural Networks (FFNN) using non-linear activation functions (like GELU):
$$ \text{FFNN}(x) = \text{GELU}(xW_1 + b_1)W_2 + b_2 $$
This happens across dozens of layers, allowing the embedding vector of the word "Next.js" to intrinsically encode its relationship to "React", "Frontend", and "Web Development".

---

## 3. Mathematical Comparison & Why Embeddings Are Better

In this project, by parsing the text through Gemini's instruction-tuned generation, we bypass the need for explicit cosine similarity algorithms because the LLM performs implicit semantic reasoning in its hidden states.

| Feature | Traditional (TF-IDF + Cosine) | Modern Embeddings (Gemini / Transformer) |
| :--- | :--- | :--- |
| **Vector Space** | Sparse, High-Dimensional ($\mathbb{R}^{V}$ where $V$ is vocabulary size, e.g., 50,000) | Dense, Low-Dimensional Continuous Space ($\mathbb{R}^{d}$ where $d \approx$ 768 to 4096) |
| **Semantic Matching** | $\vec{v}_1 \cdot \vec{v}_2 = 0$ if exact string mismatch. No synonym awareness. | $\vec{v}_1 \cdot \vec{v}_2 > 0$ for synonyms (e.g., "AI" and "Machine Learning" have high similarity). |
| **Contextual Meaning** | Static weight $w_i$. "Lead" (metal) and "Lead" (management) have the exact same representation. | Dynamic embedding $e_i$. Attention mechanism dynamically shifts the generic vector of "Lead" towards a "management" vector based on surrounding words. |
| **Computation Required** | O(N) per document scaling to vocabulary size. Cheap but rigid. | $O(L^2 \cdot d)$ per layer for self-attention, where $L$ is sequence length. Computationally expensive but yields profound semantic matching and reasoning. |

**Conclusion for this Project:**
By adopting Genkit and Gemini instead of traditional NLP (NLTK, Scikit-Learn TF-IDF), our resume matcher achieves **Zero-Shot Semantic Matching**. It mathematically understands that a candidate with "Experience in large language models" fulfills a job requirement asking for "GenAPI or Generative AI expertise", something mathematically impossible for the traditional dot-product approach without extensive manual synonym mapping.
