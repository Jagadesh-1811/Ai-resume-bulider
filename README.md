# AI Resume Builder

> **Production-Ready AI-Powered Resume Builder** — A full-stack web application that enables users to create, optimize, and export professional resumes with AI assistance, real-time ATS analysis, live preview, and multiple professional templates.

![Python](https://img.shields.io/badge/python-3.11+-blue)
![FastAPI](https://img.shields.io/badge/fastapi-0.95+-green)


## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
- [Configuration](#configuration)
- [Running the Application](#running-the-application)
- [API Documentation](#api-documentation)
- [Database Schema](#database-schema)
- [Usage Guide](#usage-guide)
- [Development](#development)

---

## Overview

AI Resume Builder is a comprehensive resume management platform that combines:
- **Intelligent Resume Creation** with AI-powered content generation
- **Real-Time ATS Analysis** to optimize resumes for Applicant Tracking Systems
- **Professional PDF Export** with multiple template options
- **Secure User Management** with JWT authentication
- **Public Sharing** capabilities with unique public resume links

The application is built with FastAPI for a robust backend API and vanilla JavaScript frontend with Supabase for database persistence.

---

## Features

- **User Authentication**
  - Register and login with email/password
  - JWT access and refresh tokens with configurable expiration
  - User profile management (full name, headline, contact info, social links)

- **Resume Builder**
  - Create unlimited resumes with custom titles and target roles
  - Add multiple resume sections: summary, experience, education, skills, projects, certifications, awards, languages
  - Real-time section editing with JSONB content storage
  - Completeness scoring based on section coverage
  - Select from multiple resume templates (ATS Minimal, Modern)

- **AI-Powered Features**
  - Generate professional summaries based on experience
  - AI-assisted bullet point generation for experience entries
  - Project description enhancement and improvement
  - Resume review and feedback
  - Text refinement and optimization suggestions

- **ATS Optimization**
  - Upload job descriptions for analysis
  - Keyword extraction and matching against resume content
  - Keyword density analysis and scoring
  - Formatting and readability assessment
  - Overall ATS compatibility score (0-100)
  - Detailed recommendations for improvement

- **Export & Sharing**
  - PDF export with professional templates
  - Multiple template options (ATS-optimized and modern designs)
  - Generate unique public resume URLs
  - Share resumes with recruiters via public links
  - Track and manage resume versions

---

## Tech Stack

| Component  | Technology                          |
|------------|-------------------------------------|
| Frontend   | HTML5, CSS3, JavaScript (ES6+)      |
| Backend    | Python 3.11+, FastAPI, Uvicorn     |
| Database   | Supabase PostgreSQL                 |
| Auth       | JWT (HS256), Passlib (bcrypt)       |
| AI         | Google Gemini API                   |
| PDF Export | WeasyPrint, Jinja2 templates        |
| HTTP       | HTTPX, Python-Multipart             |

---

## Project Structure

```
ai-resume-builder/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                    # FastAPI application entry point
│   │   ├── api/
│   │   │   ├── endpoints/
│   │   │   │   ├── __init__.py
│   │   │   │   ├── auth.py           # Authentication endpoints (register, login, refresh)
│   │   │   │   ├── resumes.py        # Resume CRUD operations
│   │   │   │   ├── ats.py            # ATS analysis endpoints
│   │   │   │   └── ai.py             # AI generation endpoints
│   │   │   └── __init__.py
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   ├── config.py             # Environment configuration
│   │   │   └── security.py           # JWT utilities, password hashing
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   ├── database.py           # Supabase client initialization
│   │   │   └── schemas.py            # Pydantic models for request/response
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── ai_service.py         # OpenAI API integration
│   │   │   ├── ats_service.py        # ATS analysis logic
│   │   │   └── pdf_service.py        # PDF generation with WeasyPrint
│   │   └── templates/
│   │       ├── ats-minimal.html      # ATS-optimized PDF template
│   │       └── modern.html           # Modern design PDF template
│   ├── requirements.txt               # Python dependencies
│   ├── .env.example                  # Example environment variables
│   └── venv/                         # Python virtual environment
├── frontend/
│   ├── index.html                    # Login/Register page
│   ├── dashboard.html                # Resume management dashboard
│   ├── builder.html                  # Resume editor page
│   ├── css/
│   │   ├── main.css                  # Global styles
│   │   ├── dashboard.css             # Dashboard page styles
│   │   └── builder.css               # Builder page styles
│   └── js/
│       ├── api.js                    # API client utilities
│       ├── auth.js                   # Authentication logic
│       ├── builder.js                # Resume builder functionality
│       └── ats.js                    # ATS analysis frontend
├── database/
│   ├── schema.sql                    # PostgreSQL schema with all tables
│   └── rls_policies.sql              # Supabase Row-Level Security policies
├── README.md                         # This file
└── deep-research-report.md          # Research documentation
```

---

## Prerequisites

- **Python 3.11+** — [Download](https://www.python.org/downloads/)
- **Node.js/npm** — (Optional, for frontend tooling)
- **Git** — [Download](https://git-scm.com/)
- **Supabase Account** — [Sign up free](https://supabase.com)
- **Google Gemini API Key** — [Get key](https://ai.google.dev/tutorials/setup) (optional, for AI features)

---

## Installation & Setup

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/ai-resume-builder.git
cd ai-resume-builder
```

### 2. Set Up Supabase Database

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and create a new query
3. Copy the contents of `database/schema.sql` and paste into the SQL Editor
4. Execute the query to create all tables and indices
5. (Optional) Copy contents of `database/rls_policies.sql` for Row-Level Security

### 3. Backend Setup

```bash
cd backend

# Create and activate virtual environment
python -m venv venv

# On Windows:
venv\Scripts\activate

# On macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 4. Frontend Setup

The frontend is pure HTML/CSS/JavaScript. No build step required. Just serve the files:

```bash
cd frontend

# Using Python's built-in server
python -m http.server 5500

# Or use Node.js http-server
npx http-server -p 5500

# Or use VS Code Live Server extension
```

---

## Configuration

### Backend Environment Variables

Create a `.env` file in the `backend/` directory:

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key

# JWT Configuration
JWT_SECRET_KEY=your-random-secret-key-min-32-chars
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=7

# Google Gemini Configuration (optional)
GEMINI_API_KEY=your-google-gemini-api-key
GEMINI_MODEL=gemini-pro

# Application
APP_NAME=AI Resume Builder
DEBUG=False
```

**Note:** Generate a secure `JWT_SECRET_KEY`:
```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### Get Your Supabase Credentials

1. In Supabase dashboard, go to **Settings → API**
2. Copy **Project URL** → `SUPABASE_URL`
3. Copy **Service Role Key** (not anon key) → `SUPABASE_KEY`

---

## Running the Application

### Start Backend Server

```bash
cd backend
source venv/bin/activate  # or venv\Scripts\activate on Windows
uvicorn app.main:app --reload --port 8000
```

The API will be available at:
- **Main API:** http://localhost:8000
- **Swagger UI Docs:** http://localhost:8000/docs
- **ReDoc Documentation:** http://localhost:8000/redoc

### Start Frontend

In another terminal:

```bash
cd frontend
python -m http.server 5500
```

Then open **http://localhost:5500** in your browser.

---

## API Documentation

### Base URL
```
http://localhost:8000/api
```

### Authentication Endpoints

#### Register User
```http
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword",
  "full_name": "John Doe"
}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```

#### Login
```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword"
}
```

#### Refresh Token
```http
POST /auth/refresh
Content-Type: application/json

{
  "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

#### Get User Profile
```http
GET /auth/profile
Authorization: Bearer <access_token>
```

### Resume Endpoints

#### Create Resume
```http
POST /resumes
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "title": "My First Resume",
  "target_role": "Software Engineer"
}
```

#### Get All Resumes
```http
GET /resumes
Authorization: Bearer <access_token>
```

#### Get Resume by ID
```http
GET /resumes/{resume_id}
Authorization: Bearer <access_token>
```

#### Update Resume
```http
PUT /resumes/{resume_id}
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "title": "Updated Resume Title",
  "target_role": "Senior Engineer"
}
```

#### Delete Resume
```http
DELETE /resumes/{resume_id}
Authorization: Bearer <access_token>
```

#### Add Resume Section
```http
POST /resumes/{resume_id}/sections
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "section_type": "experience",
  "content": {
    "company": "Tech Corp",
    "position": "Senior Engineer",
    "duration": "2020-2024"
  }
}
```

### ATS Endpoints

#### Analyze Resume for ATS Compatibility
```http
POST /ats/analyze
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "resume_id": "uuid",
  "job_description_id": "uuid"
}
```

**Response:**
```json
{
  "overall_score": 78,
  "keyword_score": 85,
  "formatting_score": 72,
  "readability_score": 76,
  "matched_keywords": ["Python", "FastAPI", "REST API"],
  "missing_keywords": ["Docker", "Kubernetes"],
  "recommendations": [
    "Add more quantifiable achievements",
    "Include relevant certifications"
  ]
}
```

#### Upload Job Description
```http
POST /ats/job-description
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "company_name": "Tech Corp",
  "role_title": "Software Engineer",
  "description_text": "We are looking for..."
}
```

### AI Endpoints

#### Generate Professional Summary
```http
POST /ai/generate-summary
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "resume_id": "uuid"
}
```

#### Generate Bullet Points
```http
POST /ai/generate-bullets
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "experience_text": "Developed web applications using Python and FastAPI",
  "context": "For a senior engineer role"
}
```

#### Improve Text
```http
POST /ai/improve-text
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "text": "Did work on project"
}
```

---

## Database Schema

### Core Tables

**Users**
- `id` (UUID) — Primary key
- `email` (VARCHAR) — Unique email address
- `password_hash` (VARCHAR) — Bcrypt hashed password
- `full_name`, `headline`, `phone`, `location` — Profile info
- `linkedin_url`, `github_url`, `portfolio_url` — Social links
- `created_at`, `updated_at` — Timestamps

**Resumes**
- `id` (UUID) — Primary key
- `user_id` (UUID) — Foreign key to users
- `title`, `target_role` — Resume metadata
- `template_id` — Selected template (ats-minimal, modern)
- `is_public`, `public_url_id` — Sharing configuration
- `completeness_score` — Progress indicator (0-100)

**Resume Sections**
- `id` (UUID) — Primary key
- `resume_id` (UUID) — Foreign key to resumes
- `section_type` — Type of section (summary, experience, education, etc.)
- `content` (JSONB) — Flexible section content
- `order_index` — Display order

**Job Descriptions**
- `id` (UUID) — Primary key
- `user_id` (UUID) — Foreign key to users
- `company_name`, `role_title` — Job metadata
- `description_text` — Full job description
- `extracted_keywords` (JSONB) — Parsed keywords

**ATS Analysis Results**
- `id` (UUID) — Primary key
- `resume_id`, `job_description_id` — References
- `overall_score`, `keyword_score`, `formatting_score`, `readability_score` — Scores
- `matched_keywords`, `missing_keywords` — Keyword analysis
- `recommendations` — Improvement suggestions

---

## Usage Guide

### 1. Register & Login

1. Open http://localhost:5500
2. Sign up with email and password
3. Log in with credentials
4. You'll be redirected to the dashboard

### 2. Create Your First Resume

1. Click "New Resume" button
2. Enter resume title and target role
3. Click "Create"

### 3. Add Content

1. In the builder, click on sections (Summary, Experience, Education, etc.)
2. Fill in your information
3. Use AI features to generate or improve content
4. Watch the completeness score update

### 4. Analyze with ATS

1. Paste a job description in the ATS panel
2. Click "Analyze"
3. Review scores and recommendations
4. Adjust content based on feedback

### 5. Export & Share

1. Click "Export to PDF"
2. Choose a template
3. Download your resume
4. Or click "Generate Public Link" to share

---

## Development

### Project Setup for Development

```bash
# Install development dependencies
pip install -r requirements.txt pytest pytest-asyncio

# Run tests
pytest

# Format code
pip install black flake8
black backend/app
flake8 backend/app

# Type checking
pip install mypy
mypy backend/app
```

### Key Dependencies

- **fastapi** — Modern web framework for building APIs
- **uvicorn** — ASGI server
- **supabase** — PostgreSQL ORM and client
- **pydantic** — Data validation
- **passlib** — Password hashing
- **python-jose** — JWT token handling
- **google-generativeai** — Gemini AI text generation
- **weasyprint** — PDF generation
- **jinja2** — Template rendering

### Future Enhancements

- [ ] PDF preview before export
- [ ] Multi-language support
- [ ] Resume templates library expansion
- [ ] LinkedIn profile import
- [ ] Batch ATS analysis for multiple resumes
- [ ] Email notifications
- [ ] Analytics dashboard for resume performance

---

## Troubleshooting

**CORS errors?**
- Ensure frontend is running on port 5500
- Check `CORS_ORIGINS` in backend config

**Supabase connection issues?**
- Verify `SUPABASE_URL` and `SUPABASE_KEY` in `.env`
- Ensure service-role key is used (not anon key)

**JWT token expired?**
- Use the refresh endpoint to get a new access token
- Check `ACCESS_TOKEN_EXPIRE_MINUTES` setting

**AI features not working?**
- Verify `GEMINI_API_KEY` is set in `.env`
- Check Google Cloud account has available credits

---

## License

This project is licensed under the MIT License — see LICENSE file for details.

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## Support

For issues, questions, or suggestions:
- Open an issue on GitHub
- Check existing documentation
- Review the deep-research-report.md for architectural details

---

**Last Updated:** May 7, 2026  
**Version:** 1.0.0
