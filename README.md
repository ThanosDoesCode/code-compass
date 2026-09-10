# CodeCompass

CodeCompass is a guided codebase intelligence tool for students and junior developers who feel lost when opening unfamiliar repositories.

Paste a public GitHub repository and CodeCompass helps explain what the project does, how it is structured, which files matter most, what concepts appear in the codebase, and what to learn next.

The goal is simple: make unfamiliar repositories easier to understand without requiring the user to already know what questions to ask.

## Overview

CodeCompass analyzes public GitHub repositories and turns them into a guided learning experience.

It combines GitHub repository data, structured AI analysis, repository-specific architecture mapping, ranked file recommendations, concept discovery, and grounded codebase chat.

Instead of only answering questions, CodeCompass proactively guides the user through the repository.

## Core Features

### Public GitHub Repository Analysis

Users can enter either:

```text
https://github.com/owner/repo
```

or:

```text
owner/repo
```

CodeCompass then:

- validates the repository
- fetches repository metadata
- detects the default branch
- resolves the latest commit SHA
- reads the repository tree
- inspects common configuration and dependency files
- selects relevant source files
- analyzes the repository using AI
- stores the result for reuse

## Repository Overview

The overview screen presents:

- repository owner and name
- description
- primary language
- star count
- default branch
- latest analyzed commit
- project summary
- technology stack
- repository snapshot

The analysis is generated from the actual repository rather than hard-coded project assumptions.

## Architecture View

CodeCompass builds a repository-specific architecture model.

Each architecture section can include:

- layer name
- description
- related files
- connected layers
- related concepts

The architecture adapts to the repository being analyzed rather than assuming a specific framework or stack.

## Start Here

One of the main goals of CodeCompass is answering:

> Which files should I read first?

The Start Here experience ranks important files and explains:

- recommended reading order
- file path
- category
- why the file matters
- beginner-friendly explanation
- difficulty
- related software engineering concepts

Users can also copy the path or open the file directly on GitHub.

## Concepts to Learn

CodeCompass detects concepts that are important for understanding the selected repository.

Examples may include:

- routing
- authentication
- state management
- API design
- database access
- dependency injection
- asynchronous programming
- component architecture
- caching

The learning path is repository-specific.

Each concept can include:

- what the concept is
- why it matters in the repository
- prerequisites
- related files
- difficulty
- recommended learning order

## Concept Detail

Selecting a concept provides a deeper explanation grounded in the analyzed repository.

Concept detail can include:

- what the concept is
- why it exists
- why the repository uses it
- where it appears
- relevant files
- code examples when available
- beginner-friendly explanation
- common misconceptions
- comprehension questions

## Ask the Codebase

CodeCompass includes a grounded AI chat for asking questions about the analyzed repository.

Example questions:

```text
Where does authentication happen?
```

```text
How does data move through this app?
```

```text
Which file should I change to modify this feature?
```

```text
Explain this file like I am a junior developer.
```

```text
Why does this project use this dependency?
```

Responses reference relevant repository files when possible.

The model is instructed not to claim knowledge of files that were not included in the repository context.

## Repository Processing

CodeCompass does not blindly send an entire repository to AI.

A deterministic selection layer prioritizes useful files such as:

- application entry points
- routing
- authentication
- API handlers
- services
- database clients
- models
- schemas
- state management
- configuration
- root layouts

It also prioritizes directories such as:

```text
src
app
pages
routes
api
server
services
lib
contexts
models
controllers
supabase
prisma
```

Generated and unnecessary files are excluded where possible, including:

```text
node_modules
build
dist
coverage
binary files
images
videos
minified bundles
large lockfiles
```

Repository and file-size limits are used to keep analysis focused and predictable.

## GitHub Data

Where available, CodeCompass collects:

- repository owner
- repository name
- description
- repository URL
- default branch
- latest commit SHA
- primary language
- star count
- README
- file tree
- dependency manifests
- configuration files
- selected source files

Common files detected include:

```text
package.json
pnpm-workspace.yaml
requirements.txt
pyproject.toml
Pipfile
pom.xml
build.gradle
Cargo.toml
go.mod
Dockerfile
docker-compose.yml
README.md
tsconfig.json
vite.config.*
next.config.*
.env.example
supabase/config.toml
```

## AI Analysis

Repository context is sent to Lovable AI in a structured format.

The AI returns structured repository analysis rather than free-form text.

The output contains data for areas such as:

- project summary
- technologies
- architecture
- important files
- concepts to learn

AI output is validated before being displayed.

Malformed responses can be retried or surfaced as an actionable error rather than silently rendering invalid data.

## Caching

CodeCompass uses Supabase to cache repository analyses.

Analyses are identified using the repository and latest commit SHA.

The flow is:

```text
Resolve repository
        ↓
Fetch latest commit SHA
        ↓
Check Supabase cache
        ↓
Cached analysis exists?
      /            \
    yes             no
     ↓               ↓
Load result      Analyze repository
                     ↓
                 Save result
```

If the repository has changed since the previous analysis, CodeCompass can detect the new commit and offer:

```text
New changes detected
```

with the option to re-analyze the latest version.

## Data Model

The MVP uses Supabase for persistence.

Core data includes:

### Repositories

```text
github_owner
github_repo
repo_url
default_branch
latest_commit_sha
metadata
created_at
updated_at
```

### Analyses

```text
repository_id
commit_sha
analysis_json
status
created_at
updated_at
```

### Chat Sessions

```text
repository_id
analysis_id
created_at
```

### Chat Messages

```text
chat_session_id
role
content
referenced_files
created_at
```

## Error Handling

CodeCompass includes dedicated states for:

- invalid GitHub URLs
- repository not found
- private repositories
- GitHub rate limits
- repositories that exceed analysis limits
- network errors
- AI analysis failures
- malformed AI output
- Supabase failures
- chat failures

Errors are designed to be understandable and actionable.

## Security

Repository contents are treated as untrusted input.

Security measures include:

- no sensitive API keys exposed in the frontend
- server-side GitHub URL validation
- input sanitization
- file-size limits
- repository-size limits
- structured AI output validation
- no execution of repository code
- no evaluation of repository scripts
- server-side privileged operations where required

Repository files may contain natural-language instructions intended to manipulate an AI model.

CodeCompass explicitly treats repository content only as data and instructs the AI not to follow instructions found inside analyzed repositories.

## Tech Stack

### Frontend

- React
- TypeScript
- Vite
- Lovable
- responsive mobile-first UI

### Backend and Persistence

- Supabase
- PostgreSQL
- Supabase Edge Functions

### AI

- Lovable AI

### Repository Data

- GitHub public repository APIs

### Development

- Git
- GitHub
- AI-assisted development workflows

## Mobile Experience

CodeCompass is designed to remain usable on smaller screens.

Responsive behavior includes:

- mobile navigation
- stacked cards
- horizontally scrollable code blocks
- intelligently truncated file paths
- responsive architecture views
- mobile-friendly repository chat

## Development

### Requirements

- Node.js
- npm

Clone the repository:

```bash
git clone https://github.com/ThanosDoesCode/code-compass.git
cd code-compass
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

## Environment Variables

Environment configuration should be added locally and never committed with real secret values.

Use the provided example environment files where available.

Public configuration may be exposed to the frontend only when it is intentionally designed to be public.

Privileged credentials should remain server-side.

## Project Structure

The exact structure may evolve, but the project is organized around the following areas:

```text
src/
  components/
  routes/
  pages/
  lib/
  integrations/

supabase/
  functions/
  migrations/

public/

docs/

tests/
```

## Product Scope

The current version focuses on the smallest credible version of the product.

The MVP intentionally does not include:

- private GitHub repositories
- GitHub OAuth
- payments
- subscriptions
- teams
- organizations
- code execution
- full coding courses
- interview preparation
- social features
- achievements
- advanced gamification

The priority is reliable repository understanding rather than adding unnecessary product surface area.

## Development Priorities

CodeCompass is being developed around these priorities:

1. Real GitHub integration
2. Real repository analysis
3. Stable structured AI output
4. Useful junior-developer guidance
5. Repository and commit-based caching
6. Grounded codebase chat
7. Error handling
8. Responsive design
9. Removal of mock data
10. Production-minded security

## Project Status

CodeCompass is actively being developed.

Current focus areas include:

- repository analysis quality
- important-file selection
- architecture explanations
- repository-specific concept discovery
- grounded codebase chat
- cache reliability
- stale commit detection
- mobile UX
- production hardening

## Author

**Thanos Xyntarakis**

Computer Science student in Sweden building full-stack applications, AI tools, and real-world software projects.

[GitHub](https://github.com/ThanosDoesCode)

[LinkedIn](https://www.linkedin.com/in/thanosxnt)
