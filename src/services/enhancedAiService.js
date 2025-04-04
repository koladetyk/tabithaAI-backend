// src/services/enhancedAiService.js
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
require('dotenv').config();

class EnhancedAiService {
  constructor() {
    this.supportedLanguages = ['en', 'ha', 'yo', 'ig']; // English, Hausa, Yoruba, Igbo
    this.llama3Endpoint = process.env.LLAMA3_API_ENDPOINT || 'https://api.replicate.com/v1/predictions';
    this.whisperEndpoint = process.env.WHISPER_API_ENDPOINT || 'https://api.openai.com/v1/audio/transcriptions';
    this.openaiChatEndpoint = 'https://api.openai.com/v1/chat/completions';
    this.llama3ApiKey = process.env.LLAMA3_API_KEY;
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.useMockAi = process.env.USE_MOCK_AI === 'true';
  }

  // Generate mock analysis data for testing
  generateMockAnalysis(text) {
    console.log('Using mock AI implementation');
    
    // Determine mock incident type based on text content
    let incidentType = 'general incident';
    if (text.toLowerCase().includes('sexual') || text.toLowerCase().includes('rape')) {
      incidentType = 'sexual abuse';
    } else if (text.toLowerCase().includes('hit') || text.toLowerCase().includes('beat')) {
      incidentType = 'physical violence';
    } else if (text.toLowerCase().includes('verbal') || text.toLowerCase().includes('insult')) {
      incidentType = 'verbal abuse';
    }

    // Determine risk level based on content analysis
    let riskLevel = 'medium';
    const highRiskWords = ['afraid', 'fear', 'kill', 'die', 'threatened', 'weapon', 'gun', 'knife'];
    const lowRiskWords = ['annoyed', 'frustrated', 'once', 'first time'];
    
    if (highRiskWords.some(word => text.toLowerCase().includes(word))) {
      riskLevel = 'high';
    } else if (lowRiskWords.some(word => text.toLowerCase().includes(word)) && 
              !highRiskWords.some(word => text.toLowerCase().includes(word))) {
      riskLevel = 'low';
    }

    return {
      emotionalContext: {
        sentiment: { label: 'negative', score: 0.8 },
        emotionalIndicators: {
          fear: text.toLowerCase().includes('afraid') || text.toLowerCase().includes('fear') || text.toLowerCase().includes('scared'),
          anxiety: true,
          trauma: text.toLowerCase().includes('trauma') || text.length > 200,
          distress: true,
          anger: text.toLowerCase().includes('angry') || text.toLowerCase().includes('anger'),
          sadness: text.toLowerCase().includes('sad') || text.toLowerCase().includes('crying')
        }
      },
      structuredData: {
        incidentType,
        location: text.toLowerCase().includes('home') ? 'Home' : (text.toLowerCase().includes('work') ? 'Workplace' : 'Unspecified'),
        timeframe: text.toLowerCase().includes('yesterday') ? 'Recent' : (text.toLowerCase().includes('year') ? 'Past year' : 'Unspecified'),
        perpetratorInfo: text.toLowerCase().includes('uncle') ? 'Family member' : 
                         (text.toLowerCase().includes('partner') ? 'Partner' : 'Known individual'),
        riskLevel
      },
      suggestedServices: [
        'counseling',
        incidentType.includes('sexual') || incidentType.includes('physical') ? 'medical' : 'support_group',
        'legal_aid',
        riskLevel === 'high' ? 'shelter' : 'hotline'
      ],
      recommendations: [
        'Document all incidents with dates and details',
        riskLevel === 'high' ? 'Create a safety plan immediately' : 'Consider creating a safety plan',
        'Connect with a professional counselor for support',
        incidentType.includes('sexual') ? 'Consider seeking medical attention' : 'Build a support network'
      ],
      confidence: 0.9,
      processingTime: 1500,
      isMock: true
    };
  }

  async processWithLlama3(text, language = 'en') {
    try {
      console.log(`Processing text with Llama3 in language ${language}: ${text.substring(0, 50)}...`);
      
      // If mock mode is enabled, return mock data
      if (this.useMockAi) {
        return this.generateMockAnalysis(text);
      }

      // Record start time for processing time calculation
      const startTime = Date.now();
      
      // Create prompt for Llama3 - structured to get JSON response
      const prompt = `You are an AI assistant for a gender-based violence reporting system. Analyze the following report in ${language} and extract key information.
Extract emotional indicators, sentiment, incident type, location, risk level, and recommended services.
Return your analysis in valid JSON format only, with the following structure:
{
  "emotionalContext": {
    "sentiment": {"label": "negative/neutral/positive", "score": 0.0-1.0},
    "emotionalIndicators": {"fear": boolean, "anxiety": boolean, "trauma": boolean, "distress": boolean, "anger": boolean, "sadness": boolean}
  },
  "structuredData": {
    "incidentType": "string",
    "location": "string",
    "timeframe": "string",
    "perpetratorInfo": "string",
    "riskLevel": "low/medium/high"
  },
  "suggestedServices": ["counseling", "legal_aid", "shelter", "medical"],
  "recommendations": ["string", "string", "string"],
  "confidence": 0.0-1.0
}

Report: ${text}
JSON Response:`;
      
      if (!this.llama3ApiKey) {
        throw new Error('Llama3 API key not configured');
      }
      
      // Try different model IDs
      const modelVersions = [
        "a16z-infra/llama-3-8b-instruct",
        "replicate/llama-3-8b-instruct",
        "replicate/llama-2-70b-chat",
        "meta/llama-3-8b-instruct"
      ];
      
      let lastError = null;
      let response = null;
      
      // Try each model version until one works
      for (const modelVersion of modelVersions) {
        try {
          console.log(`Trying model version: ${modelVersion}`);
          response = await axios.post(
            this.llama3Endpoint,
            {
              version: modelVersion,
              input: {
                prompt,
                max_tokens: 2000,
                temperature: 0.1
              }
            },
            {
              headers: {
                'Authorization': `Token ${this.llama3ApiKey}`,
                'Content-Type': 'application/json'
              }
            }
          );
          if (response) break; // If successful, break the loop
        } catch (error) {
          lastError = error;
          console.error(`Failed with model ${modelVersion}:`, error.message);
          // Continue to try next model
        }
      }
      
      if (!response) {
        throw lastError || new Error("All Llama model versions failed");
      }
      
      // Poll for completion (since Replicate is asynchronous)
      let completionResponse = response.data;
      let attempts = 0;
      const maxAttempts = 30;
      
      while (completionResponse.status !== 'succeeded' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        try {
          const checkResponse = await axios.get(
            completionResponse.urls.get,
            {
              headers: {
                'Authorization': `Token ${this.llama3ApiKey}`,
                'Content-Type': 'application/json'
              }
            }
          );
          completionResponse = checkResponse.data;
        } catch (pollError) {
          console.error('Error polling for completion:', pollError);
          if (pollError.response) {
            console.error('Poll error response:', pollError.response.data);
          }
        }
        attempts++;
      }
      
      if (completionResponse.status !== 'succeeded') {
        throw new Error('Llama3 processing timed out or failed');
      }
      
      // Calculate processing time
      const processingTime = Date.now() - startTime;
      
      // Extract the JSON response
      const outputText = completionResponse.output.join('');
      let jsonResponse;
      
      try {
        // Extract JSON from the response (handling potential text before or after JSON)
        const jsonMatch = outputText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonResponse = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No valid JSON found in response');
        }
      } catch (jsonError) {
        console.error('Error parsing JSON response:', jsonError);
        console.error('Raw output:', outputText);
        throw new Error('Invalid response format from Llama3');
      }
      
      // Add processing time to response
      jsonResponse.processingTime = processingTime;
      
      return jsonResponse;
    } catch (error) {
      console.error('Error in Llama3 processing:', error);
      
      // Enhanced error logging
      if (error.response) {
        console.error('Error response data:', error.response.data);
        console.error('Error response status:', error.response.status);
      }
      
      // Fall back to OpenAI if Llama3 fails
      try {
        console.log('Falling back to OpenAI...');
        return await this.processWithOpenAI(text, language);
      } catch (openaiError) {
        console.error('OpenAI fallback also failed:', openaiError);
        // Fall back to mock data as a last resort
        return this.generateMockAnalysis(text);
      }
    }
  }

  async processWithOpenAI(text, language = 'en') {
    try {
      console.log(`Processing text with OpenAI in language ${language}: ${text.substring(0, 50)}...`);
      
      // If mock mode is enabled, return mock data
      if (this.useMockAi) {
        return this.generateMockAnalysis(text);
      }
      
      // Record start time for processing time calculation
      const startTime = Date.now();
      
      if (!this.openaiApiKey) {
        throw new Error('OpenAI API key not configured');
      }
      
      const response = await axios.post(
        this.openaiChatEndpoint,
        {
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content: "You are an expert in analyzing gender-based violence reports. Always respond in valid JSON format."
            },
            {
              role: "user",
              content: `Analyze the following report in ${language} and extract key information.
                Extract emotional indicators, sentiment, incident type, location, risk level, and recommended services.
                Return your analysis in valid JSON format only, with the following structure:
                {
                  "emotionalContext": {
                    "sentiment": {"label": "negative/neutral/positive", "score": 0.0-1.0},
                    "emotionalIndicators": {"fear": boolean, "anxiety": boolean, "trauma": boolean, "distress": boolean, "anger": boolean, "sadness": boolean}
                  },
                  "structuredData": {
                    "incidentType": "string",
                    "location": "string",
                    "timeframe": "string",
                    "perpetratorInfo": "string",
                    "riskLevel": "low/medium/high"
                  },
                  "suggestedServices": ["counseling", "legal_aid", "shelter", "medical"],
                  "recommendations": ["string", "string", "string"],
                  "confidence": 0.0-1.0
                }

                Report: ${text}
                JSON Response:`
            }
          ],
          temperature: 0.1
        },
        {
          headers: {
            'Authorization': `Bearer ${this.openaiApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      // Calculate processing time
      const processingTime = Date.now() - startTime;
      
      // Extract the JSON response from OpenAI's response
      const outputText = response.data.choices[0].message.content;
      let jsonResponse;
      
      try {
        // Extract JSON from the response (handling potential text before or after JSON)
        const jsonMatch = outputText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonResponse = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No valid JSON found in response');
        }
      } catch (jsonError) {
        console.error('Error parsing JSON response:', jsonError);
        console.error('Raw output:', outputText);
        throw new Error('Invalid response format from OpenAI');
      }
      
      // Add processing time to response
      jsonResponse.processingTime = processingTime;
      jsonResponse.model = "openai";
      
      return jsonResponse;
    } catch (error) {
      console.error('Error in OpenAI processing:', error);
      if (error.response) {
        console.error('Error response data:', error.response.data);
        console.error('Error response status:', error.response.status);
      }
      
      // Fall back to mock data
      return this.generateMockAnalysis(text);
    }
  }

  async transcribeAudio(audioFilePath, language = 'en') {
    try {
      console.log(`Transcribing audio file: ${audioFilePath}`);
      
      // If mock mode is enabled, return mock transcription
      if (this.useMockAi) {
        console.log('Using mock transcription');
        return {
          transcription: "This is a mock transcription of the audio file. In a real scenario, this would be the actual content of the audio.",
          success: true,
          isMock: true
        };
      }

      if (!this.openaiApiKey) {
        throw new Error('OpenAI API key not configured');
      }
      
      // Ensure the file exists
      if (!fs.existsSync(audioFilePath)) {
        throw new Error(`Audio file not found: ${audioFilePath}`);
      }
      
      // Create form data
      const formData = new FormData();
      formData.append('file', fs.createReadStream(audioFilePath));
      formData.append('model', 'whisper-1');
      
      // Whisper auto-detects language, but we can specify it if needed
      if (language && language !== 'auto') {
        formData.append('language', language);
      }
      
      // Call Whisper API
      const response = await axios.post(
        this.whisperEndpoint,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${this.openaiApiKey}`,
            ...formData.getHeaders()
          }
        }
      );
      
      return {
        transcription: response.data.text,
        success: true
      };
    } catch (error) {
      console.error('Error transcribing audio with Whisper:', error);
      
      // Detailed error logging
      if (error.response) {
        console.error('Error response data:', error.response.data);
        console.error('Error response status:', error.response.status);
      }
      
      // Return mock transcription as fallback when in production
      if (!this.useMockAi) {
        console.log('Falling back to mock transcription');
        return {
          transcription: "Unable to transcribe audio. This is a fallback transcription.",
          success: true,
          isFallback: true
        };
      }
      
      return {
        transcription: "Error transcribing audio. Please try again or submit a text report.",
        success: false,
        error: error.message
      };
    }
  }

  async processVoiceInput(audioFilePath, language = 'en') {
    try {
      // First, transcribe the audio
      const transcriptionResult = await this.transcribeAudio(audioFilePath, language);
      
      if (!transcriptionResult.success) {
        throw new Error('Failed to transcribe audio');
      }
      
      const transcribedText = transcriptionResult.transcription;
      
      // Then process the transcribed text with AI
      const aiResult = this.useMockAi 
        ? this.generateMockAnalysis(transcribedText)
        : await this.processWithOpenAI(transcribedText, language);
      
      // Generate a unique ID for this interaction
      const interactionId = uuidv4();
      
      // Don't immediately record to database - we'll do this after the report is created
      
      return {
        transcription: transcribedText,
        aiAnalysis: aiResult,
        filePath: audioFilePath,
        language,
        interactionId,
        createdAt: new Date()
      };
    } catch (error) {
      console.error('Error processing voice input:', error);
      return {
        error: error.message,
        success: false
      };
    }
  }
  
  // Record AI interaction in database
  async recordInteraction(userId, reportId, interactionType, inputSummary, outputSummary, confidenceScore, processingTime, modelVersion) {
    try {
      const interactionId = uuidv4();
      
      const result = await db.query(
        `INSERT INTO ai_interactions (
          id,
          user_id,
          report_id,
          interaction_type,
          input_summary,
          output_summary,
          confidence_score,
          processing_time,
          model_version,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP) RETURNING *`,
        [
          interactionId,
          userId,
          reportId,
          interactionType,
          inputSummary,
          outputSummary,
          confidenceScore,
          processingTime,
          modelVersion
        ]
      );
      
      return result.rows[0];
    } catch (error) {
      console.error('Error recording AI interaction:', error);
      return null;
    }
  }
}

// Create and export a singleton instance
const enhancedAiService = new EnhancedAiService();

module.exports = {
  enhancedAiService,
  // Default to OpenAI processing for more reliable results
  processWithAI: (text, language) => enhancedAiService.processWithOpenAI(text, language),
  transcribeAudio: (audioFilePath, language) => enhancedAiService.transcribeAudio(audioFilePath, language),
  processVoiceInput: (audioFilePath, language) => enhancedAiService.processVoiceInput(audioFilePath, language),
  recordInteraction: (userId, reportId, interactionType, inputSummary, outputSummary, confidenceScore, processingTime, modelVersion) => 
    enhancedAiService.recordInteraction(userId, reportId, interactionType, inputSummary, outputSummary, confidenceScore, processingTime, modelVersion)
};