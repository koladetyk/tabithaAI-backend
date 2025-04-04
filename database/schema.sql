-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    phone_number VARCHAR(20),
    date_of_birth DATE,
    language_preference VARCHAR(10) DEFAULT 'en',
    location_data JSONB,
    is_verified BOOLEAN DEFAULT FALSE,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

-- Reports table
CREATE TABLE reports (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    anonymous BOOLEAN DEFAULT FALSE,
    incident_date TIMESTAMP,
    report_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    location_data JSONB,
    incident_type VARCHAR(50),
    incident_description TEXT,
    emotional_context JSONB,
    status VARCHAR(20) DEFAULT 'submitted',
    language VARCHAR(10),
    confidentiality_level INTEGER DEFAULT 1,
    original_input_type VARCHAR(20),
    original_content_ref VARCHAR(255),
    ai_processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Evidence table
CREATE TABLE evidence (
    id UUID PRIMARY KEY,
    report_id UUID REFERENCES reports(id),
    evidence_type VARCHAR(50),
    file_path VARCHAR(255),
    description TEXT,
    submitted_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ai_analysis_results JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Service providers table
CREATE TABLE service_providers (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    provider_type VARCHAR(50) NOT NULL,
    description TEXT,
    contact_info JSONB,
    location_data JSONB,
    operating_hours JSONB,
    services_offered TEXT[],
    languages_supported TEXT[],
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Referrals table
CREATE TABLE referrals (
    id UUID PRIMARY KEY,
    report_id UUID REFERENCES reports(id),
    service_provider_id UUID REFERENCES service_providers(id),
    referral_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    referral_status VARCHAR(20) DEFAULT 'pending',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AI interactions table
CREATE TABLE ai_interactions (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    report_id UUID REFERENCES reports(id) NULL,
    interaction_type VARCHAR(50),
    input_summary TEXT,
    output_summary TEXT,
    confidence_score FLOAT,
    processing_time INTEGER,
    model_version VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notifications table
CREATE TABLE notifications (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    notification_type VARCHAR(50),
    related_entity_type VARCHAR(50),
    related_entity_id UUID,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Resources table
CREATE TABLE resources (
    id UUID PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    content_type VARCHAR(50),
    category VARCHAR(50),
    language VARCHAR(10),
    file_path VARCHAR(255),
    tags TEXT[],
    is_published BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
