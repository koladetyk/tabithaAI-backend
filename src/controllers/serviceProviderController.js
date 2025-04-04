// src/controllers/serviceProviderController.js
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

class ServiceProviderController {
  // Get all service providers
  async getAllProviders(req, res) {
    try {
      const providers = await db.query(
        'SELECT * FROM service_providers ORDER BY name ASC'
      );
      
      return res.status(200).json({
        success: true,
        count: providers.rows.length,
        data: providers.rows
      });
    } catch (error) {
      console.error('Error fetching service providers:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error retrieving service providers',
        error: error.message
      });
    }
  }

  // Get service provider by ID
  async getProviderById(req, res) {
    try {
      const providerId = req.params.id;
      
      const provider = await db.query(
        'SELECT * FROM service_providers WHERE id = $1',
        [providerId]
      );
      
      if (provider.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Service provider not found'
        });
      }
      
      return res.status(200).json({
        success: true,
        data: provider.rows[0]
      });
    } catch (error) {
      console.error('Error fetching service provider:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error retrieving service provider',
        error: error.message
      });
    }
  }

  // Create new service provider (admin only)
  async createProvider(req, res) {
    try {
      const {
        name,
        provider_type,
        description,
        contact_info,
        location_data,
        operating_hours,
        services_offered,
        languages_supported
      } = req.body;
      
      // Validate required fields
      if (!name || !provider_type) {
        return res.status(400).json({
          success: false,
          message: 'Please provide name and provider_type'
        });
      }
      
      // Generate new UUID for provider
      const providerId = uuidv4();
      
      // Create new provider
      const newProvider = await db.query(
        `INSERT INTO service_providers (
          id,
          name,
          provider_type,
          description,
          contact_info,
          location_data,
          operating_hours,
          services_offered,
          languages_supported,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
        [
          providerId,
          name,
          provider_type,
          description || null,
          contact_info || {},
          location_data || {},
          operating_hours || {},
          services_offered || [],
          languages_supported || []
        ]
      );
      
      return res.status(201).json({
        success: true,
        data: newProvider.rows[0],
        message: 'Service provider created successfully'
      });
    } catch (error) {
      console.error('Error creating service provider:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error creating service provider',
        error: error.message
      });
    }
  }

  // Update service provider (admin only)
  async updateProvider(req, res) {
    try {
      const providerId = req.params.id;
      const {
        name,
        provider_type,
        description,
        contact_info,
        location_data,
        operating_hours,
        services_offered,
        languages_supported,
        is_verified
      } = req.body;
      
      // Check if provider exists
      const existingProvider = await db.query(
        'SELECT * FROM service_providers WHERE id = $1',
        [providerId]
      );
      
      if (existingProvider.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Service provider not found'
        });
      }
      
      // Update provider
      const updatedProvider = await db.query(
        `UPDATE service_providers SET
          name = COALESCE($1, name),
          provider_type = COALESCE($2, provider_type),
          description = COALESCE($3, description),
          contact_info = COALESCE($4, contact_info),
          location_data = COALESCE($5, location_data),
          operating_hours = COALESCE($6, operating_hours),
          services_offered = COALESCE($7, services_offered),
          languages_supported = COALESCE($8, languages_supported),
          is_verified = COALESCE($9, is_verified),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $10
        RETURNING *`,
        [
          name,
          provider_type,
          description,
          contact_info,
          location_data,
          operating_hours,
          services_offered,
          languages_supported,
          is_verified,
          providerId
        ]
      );
      
      return res.status(200).json({
        success: true,
        data: updatedProvider.rows[0],
        message: 'Service provider updated successfully'
      });
    } catch (error) {
      console.error('Error updating service provider:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error updating service provider',
        error: error.message
      });
    }
  }

  // Delete service provider (admin only)
  async deleteProvider(req, res) {
    try {
      const providerId = req.params.id;
      
      // Check if provider exists
      const existingProvider = await db.query(
        'SELECT * FROM service_providers WHERE id = $1',
        [providerId]
      );
      
      if (existingProvider.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Service provider not found'
        });
      }
      
      // Check for referrals to this provider
      const referrals = await db.query(
        'SELECT COUNT(*) FROM referrals WHERE service_provider_id = $1',
        [providerId]
      );
      
      // If referrals exist, prevent deletion
      if (parseInt(referrals.rows[0].count) > 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete provider with existing referrals'
        });
      }
      
      // Delete the provider
      await db.query(
        'DELETE FROM service_providers WHERE id = $1',
        [providerId]
      );
      
      return res.status(200).json({
        success: true,
        message: 'Service provider deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting service provider:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error deleting service provider',
        error: error.message
      });
    }
  }

  // Search for nearby providers
  async searchNearbyProviders(req, res) {
    try {
      const { latitude, longitude, radius = 10, services, languages, provider_type } = req.query;
      
      // Validate location data
      if (!latitude || !longitude) {
        return res.status(400).json({
          success: false,
          message: 'Latitude and longitude are required for location-based search'
        });
      }
      
      // Convert parameters to numbers
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      const searchRadius = parseFloat(radius);
      
      // Base query with distance calculation using PostgreSQL's earthdistance extension
      // Note: This requires the earthdistance and cube extensions to be enabled in PostgreSQL
      let query = `
        SELECT 
          id, 
          name, 
          provider_type, 
          description, 
          contact_info, 
          location_data, 
          operating_hours, 
          services_offered, 
          languages_supported,
          is_verified,
          earth_distance(
            ll_to_earth($1, $2), 
            ll_to_earth(
              (location_data->>'latitude')::float, 
              (location_data->>'longitude')::float
            )
          ) / 1000 AS distance_km
        FROM 
          service_providers
        WHERE 
          location_data->>'latitude' IS NOT NULL 
          AND location_data->>'longitude' IS NOT NULL
      `;
      
      // Parameters array starting with lat/lng
      const queryParams = [lat, lng];
      let paramIndex = 3;
      
      // Add optional filters
      if (provider_type) {
        query += ` AND provider_type = $${paramIndex}`;
        queryParams.push(provider_type);
        paramIndex++;
      }
      
      if (services) {
        const servicesList = services.split(',');
        query += ` AND services_offered && $${paramIndex}::text[]`;
        queryParams.push(servicesList);
        paramIndex++;
      }
      
      if (languages) {
        const languagesList = languages.split(',');
        query += ` AND languages_supported && $${paramIndex}::text[]`;
        queryParams.push(languagesList);
        paramIndex++;
      }
      
      // Add distance filter and order by distance
      query += `
        HAVING earth_distance(
          ll_to_earth($1, $2), 
          ll_to_earth(
            (location_data->>'latitude')::float, 
            (location_data->>'longitude')::float
          )
        ) / 1000 <= $${paramIndex}
        ORDER BY distance_km ASC
      `;
      queryParams.push(searchRadius);
      
      // If earthdistance extension is not available, fall back to a basic query
      try {
        const providers = await db.query(query, queryParams);
        
        return res.status(200).json({
          success: true,
          count: providers.rows.length,
          data: providers.rows
        });
      } catch (earthDistanceError) {
        console.error('Earth distance query failed, using fallback:', earthDistanceError);
        
        // Fallback query without advanced geospatial features
        // This is less accurate but will work without extensions
        const fallbackProviders = await db.query(
          'SELECT * FROM service_providers WHERE 1=1' + 
          (provider_type ? ' AND provider_type = $1' : ''),
          provider_type ? [provider_type] : []
        );
        
        // Manually calculate approximate distance
        // This is very approximate and not for production use
        const filteredProviders = fallbackProviders.rows
          .filter(provider => {
            if (!provider.location_data || !provider.location_data.latitude || !provider.location_data.longitude) {
              return false;
            }
            
            const providerLat = parseFloat(provider.location_data.latitude);
            const providerLng = parseFloat(provider.location_data.longitude);
            
            // Simple distance calculation (in degrees, not km - just for filtering)
            const distance = Math.sqrt(
              Math.pow(providerLat - lat, 2) + 
              Math.pow(providerLng - lng, 2)
            );
            
            // Roughly filter by radius (very approximate)
            return distance < (searchRadius / 111); // ~111km per degree
          })
          .map(provider => ({
            ...provider,
            distance_km: 'Approximate'
          }));
        
        return res.status(200).json({
          success: true,
          count: filteredProviders.length,
          data: filteredProviders,
          message: 'Using approximate location search'
        });
      }
    } catch (error) {
      console.error('Error searching nearby providers:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error searching providers',
        error: error.message
      });
    }
  }

  // Search providers by criteria
  async searchProviders(req, res) {
    try {
      const { q, provider_type, services, languages } = req.query;
      
      let query = 'SELECT * FROM service_providers WHERE 1=1';
      const queryParams = [];
      let paramIndex = 1;
      
      // Add search term
      if (q) {
        query += ` AND (
          name ILIKE $${paramIndex} OR
          description ILIKE $${paramIndex}
        )`;
        queryParams.push(`%${q}%`);
        paramIndex++;
      }
      
      // Add provider type filter
      if (provider_type) {
        query += ` AND provider_type = $${paramIndex}`;
        queryParams.push(provider_type);
        paramIndex++;
      }
      
      // Add services filter
      if (services) {
        const servicesList = services.split(',');
        query += ` AND services_offered && $${paramIndex}::text[]`;
        queryParams.push(servicesList);
        paramIndex++;
      }
      
      // Add languages filter
      if (languages) {
        const languagesList = languages.split(',');
        query += ` AND languages_supported && $${paramIndex}::text[]`;
        queryParams.push(languagesList);
        paramIndex++;
      }
      
      // Order results
      query += ' ORDER BY name ASC';
      
      const providers = await db.query(query, queryParams);
      
      return res.status(200).json({
        success: true,
        count: providers.rows.length,
        data: providers.rows
      });
    } catch (error) {
      console.error('Error searching providers:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error searching providers',
        error: error.message
      });
    }
  }
}

module.exports = new ServiceProviderController();