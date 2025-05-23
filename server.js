const https = require('https');

// Add these environment variables or replace with your values
const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_ZONE_ID = process.env.CF_ZONE_ID;
const CF_RECORD_NAME = process.env.CF_RECORD_NAME;
const UPDATE_INTERVAL = parseInt(process.env.UPDATE_INTERVAL || '3600000', 10); // 1 hour default

// Function to fetch public IP
function updatePublicIP() {
    const options = {
        hostname: 'myip.dk',
        path: '/',
        headers: {
            'User-Agent': 'curl/7.88.1'
        }
    };

    https.get(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
            data += chunk;
        });

        res.on('end', () => {
            // Extract IP from the response using regex
            const ipMatch = data.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
            if (ipMatch) {
                console.log(`IP: "${ipMatch[0]}"`);
                updateCloudflareDNS(ipMatch[0]);
            } else {
                console.log('Could not extract IP from response');
                process.exit(1);
            }
        });
    }).on('error', (err) => {
        console.error('Error fetching public IP:', err.message);
    });
}

function updateCloudflareDNS(newIP) {
    // List all A records without name filter
    const listOptions = {
        hostname: 'api.cloudflare.com',
        path: `/client/v4/zones/${CF_ZONE_ID}/dns_records?type=A`,
        headers: {
            'Authorization': `Bearer ${CF_API_TOKEN}`,
            'Content-Type': 'application/json'
        }
    };

    https.get(listOptions, (res) => {
        let data = '';

        res.on('data', chunk => data += chunk);

        res.on('end', () => {
            const response = JSON.parse(data);
            if (!response.success) {
                console.error('Failed to fetch DNS records:', response.errors);
                return;
            }

            // Convert wildcard pattern to regex
            const wildcardToRegex = CF_RECORD_NAME.replace(/\./g, '\\.').replace(/\*/g, '.*');
            const namePattern = new RegExp(`^${wildcardToRegex}$`);

            // Filter records that match the pattern
            const matchingRecords = response.result.filter(record => namePattern.test(record.name));

            if (matchingRecords.length === 0) {
                console.error('No matching DNS records found for pattern:', CF_RECORD_NAME);
                return;
            }

            console.log(`Found ${matchingRecords.length} matching records`);

            // Update all matching records
            matchingRecords.forEach(record => {
                // Skip if IP hasn't changed
                if (record.content === newIP) {
                    console.log(`IP unchanged for ${record.name}, skipping`);
                    return;
                }

                const updateOptions = {
                    hostname: 'api.cloudflare.com',
                    path: `/client/v4/zones/${CF_ZONE_ID}/dns_records/${record.id}`,
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${CF_API_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                };

                const updateReq = https.request(updateOptions, (updateRes) => {
                    let updateData = '';
                    
                    updateRes.on('data', chunk => updateData += chunk);
                    
                    updateRes.on('end', () => {
                        const updateResponse = JSON.parse(updateData);
                        if (updateResponse.success) {
                            console.log(`DNS record ${record.name} updated successfully to ${newIP}`);
                        } else {
                            console.error(`Failed to update DNS record ${record.name}:`, updateResponse.errors);
                        }
                    });
                });

                updateReq.on('error', (error) => {
                    console.error(`Error updating DNS record ${record.name}:`, error);
                });

                updateReq.write(JSON.stringify({
                    type: 'A',
                    name: record.name,
                    content: newIP,
                    proxied: record.proxied  // Maintain existing proxied status
                }));

                updateReq.end();
            });
        });
    }).on('error', (error) => {
        console.error('Error fetching DNS records:', error);
    });
}

// Run immediately on startup
updatePublicIP();

// Then run based on UPDATE_INTERVAL environment variable
setInterval(updatePublicIP, UPDATE_INTERVAL);
