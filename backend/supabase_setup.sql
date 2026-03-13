-- SUPABASE SCHEMA SETUP 
-- Run these queries in the Supabase SQL Editor to prepare your database.

-- 1. Resumes Table
CREATE TABLE IF NOT EXISTS public.resumes (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    resume_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS for resumes
ALTER TABLE public.resumes ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see and edit their own resumes
CREATE POLICY "Users can manage their own resumes" 
ON public.resumes FOR ALL 
USING (auth.uid() = user_id);

-- 2. Chat Messages Table (History)
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    role TEXT CHECK (role IN ('user', 'assistant')),
    content TEXT,
    extracted_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Note: You can enable RLS on chat_messages if you link them to user_id, 
-- but currently main.py queries them by session_id.

-- 3. Resume Analysis Reports Table
CREATE TABLE IF NOT EXISTS public.resume_analysis_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resume_id TEXT REFERENCES public.resumes(id) ON DELETE CASCADE,
    score INT,
    metrics JSONB DEFAULT '{}'::jsonb,
    feedback JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Utility: Auto-update updated_at for resumes
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_resumes_modtime
    BEFORE UPDATE ON public.resumes
    FOR EACH ROW
    EXECUTE PROCEDURE update_modified_column();
