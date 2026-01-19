const axios = require("axios");
const qs = require("qs");

// User-Agent Pool (Mobile + Desktop)
const USER_AGENTS = [
  // Android - Instagram App
  "Instagram 219.0.0.12.117 Android (31/12; 320dpi; 720x1280; samsung; SM-G960F; starlte; samsungexynos9810; en_US; 340910260)",
  "Instagram 250.0.0.21.109 Android (30/11; 420dpi; 1080x2340; Xiaomi; Mi 10; umi; qcom; en_US; 400534612)",
  "Instagram 245.0.0.18.110 Android (29/10; 480dpi; 1080x2280; OnePlus; ONEPLUS A6013; OnePlus6T; qcom; en_US; 389773013)",
  "Instagram 236.0.0.20.109 Android (32/12; 440dpi; 1080x2400; Google; Pixel 6; oriole; google; en_US; 378629382)",

  // iOS - Instagram App
  "Instagram 275.0.0.16.92 (iPhone14,5; iOS 16_5; en_US; en; scale=3.00; 1170x2532; 444218278)",
  "Instagram 270.0.0.18.103 (iPhone13,2; iOS 15_6; en_US; en; scale=2.00; 1080x2340; 438414248)",
  "Instagram 268.0.0.18.75 (iPhone12,1; iOS 16_1; en_US; en; scale=2.00; 828x1792; 436380008)",

  // Desktop - Chrome
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",

  // Desktop - Firefox
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/120.0",

  // Desktop - Safari
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",

  // Mobile - Chrome
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 12; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",

  // Mobile - Safari (iOS)
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Get mobile Instagram app UA only (for story/feed endpoints)
function getMobileInstagramUA() {
  const mobileAppUAs = USER_AGENTS.filter((ua) => ua.startsWith("Instagram"));
  return mobileAppUAs[Math.floor(Math.random() * mobileAppUAs.length)];
}

// Retry logic with exponential backoff
let errorMonitorCallback = null;

function setErrorMonitor(callback) {
  errorMonitorCallback = callback;
}

async function retryWithBackoff(fn, maxRetries = 3) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on auth errors (401, 403, 404)
      if (error.response && [401, 403, 404].includes(error.response.status)) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === maxRetries - 1) {
        // Alert monitoring system
        if (errorMonitorCallback) {
          errorMonitorCallback({
            type: "instagram_api_failure",
            error: error.message,
            attempts: maxRetries,
          });
        }
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, attempt) * 1000;
      console.log(
        `⚠️ Request failed (attempt ${
          attempt + 1
        }/${maxRetries}). Retrying in ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

async function instagramGetUrl(url_media) {
  try {
    url_media = await checkRedirect(url_media);

    if (url_media.includes("/stories/")) {
      const storyId = getStoryId(url_media);
      const storyData = await getStoryData(storyId);
      return storyData;
    }

    const SHORTCODE = getShortcode(url_media);
    const INSTAGRAM_REQUEST = await instagramRequest(SHORTCODE);
    const OUTPUT_DATA = createOutputData(INSTAGRAM_REQUEST);
    return OUTPUT_DATA;
  } catch (err) {
    throw err;
  }
}

function getCookies() {
  const cookieEnv = process.env.INSTAGRAM_COOKIES || "";
  if (!cookieEnv) return "";

  // Support multiple cookies separated by ;;;
  const cookiePool = cookieEnv
    .split(";;;")
    .map((c) => c.trim())
    .filter((c) => c);

  if (cookiePool.length === 0) return "";
  if (cookiePool.length === 1) return cookiePool[0];

  // Randomly select a cookie from the pool
  return cookiePool[Math.floor(Math.random() * cookiePool.length)];
}

async function checkRedirect(url) {
  const headers = {};
  const cookies = getCookies();
  if (cookies) {
    headers["Cookie"] = cookies;
  }

  if (url.includes("/share/") || url.includes("share")) {
    try {
      let res = await axios.get(url, { headers, timeout: 15000 });
      return res.request.res.responseUrl || res.request.path || url;
    } catch (e) {
      return url;
    }
  }
  return url;
}

function getShortcode(url) {
  try {
    let split_url = url.split("/");
    let post_tags = ["p", "reel", "tv", "reels"];
    let index_shortcode =
      split_url.findIndex((item) => post_tags.includes(item)) + 1;
    let shortcode = split_url[index_shortcode];
    if (!shortcode) throw new Error("Could not parse shortcode");
    return shortcode;
  } catch (err) {
    throw new Error(`Failed to obtain shortcode: ${err.message}`);
  }
}

function getStoryId(url) {
  try {
    const match = url.match(/\/stories\/[^/]+\/(\d+)/);
    if (match && match[1]) {
      return match[1];
    }
    throw new Error("Could not parse story ID");
  } catch (err) {
    throw new Error(`Invalid Story Link: ${err.message}`);
  }
}

async function getStoryData(storyId) {
  try {
    const cookies = getCookies();
    if (!cookies) throw new Error("Cookies missing. Cannot fetch stories.");

    const config = {
      method: "GET",
      url: `https://i.instagram.com/api/v1/media/${storyId}/info/`,
      headers: {
        "User-Agent": getMobileInstagramUA(),
        Cookie: cookies,
      },
      timeout: 15000,
    };

    const { data } = await retryWithBackoff(() => axios.request(config));
    if (!data.items || data.items.length === 0) {
      throw new Error("Story expired or account is private.");
    }

    const item = data.items[0];
    const media_details = [];

    if (item.media_type === 1) {
      media_details.push({
        type: "image",
        url: item.image_versions2.candidates[0].url,
        dimensions: {
          height: item.image_versions2.candidates[0].height,
          width: item.image_versions2.candidates[0].width,
        },
      });
    } else if (item.media_type === 2) {
      media_details.push({
        type: "video",
        url: item.video_versions[0].url,
        thumbnail: item.image_versions2.candidates[0].url,
        dimensions: {
          height: item.video_versions[0].height,
          width: item.video_versions[0].width,
        },
      });
    }

    return {
      results_number: 1,
      url_list: [media_details[0].url],
      post_info: {
        owner_username: item.user.username,
        owner_fullname: item.user.full_name,
        caption: item.caption ? item.caption.text : "",
      },
      media_details: media_details,
    };
  } catch (err) {
    throw new Error(`Story Fetch Failed: ${err.message}`);
  }
}

async function getStoriesByUsername(username) {
  try {
    const userId = await getUserId(username);
    const cookies = getCookies();
    if (!cookies) throw new Error("Cookies missing.");

    const config = {
      method: "GET",
      url: `https://i.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`,
      headers: {
        "User-Agent": getMobileInstagramUA(),
        Cookie: cookies,
      },
      timeout: 15000,
    };

    const { data } = await retryWithBackoff(() => axios.request(config));
    const reel = data.reels[userId];
    if (!reel || !reel.items || reel.items.length === 0) {
      throw new Error("No active stories found for this user.");
    }

    const media_details = reel.items.map((item) => {
      if (item.media_type === 1) {
        return {
          type: "image",
          url: item.image_versions2.candidates[0].url,
          dimensions: {
            height: item.image_versions2.candidates[0].height,
            width: item.image_versions2.candidates[0].width,
          },
        };
      } else {
        return {
          type: "video",
          url: item.video_versions[0].url,
          thumbnail: item.image_versions2.candidates[0].url,
          dimensions: {
            height: item.video_versions[0].height,
            width: item.video_versions[0].width,
          },
        };
      }
    });

    return {
      results_number: media_details.length,
      post_info: {
        owner_username: reel.user.username,
        owner_fullname: reel.user.full_name,
        caption: `Current Stories of ${reel.user.username}`,
      },
      media_details: media_details,
    };
  } catch (err) {
    throw new Error(`Failed to fetch stories: ${err.message}`);
  }
}

async function getUserId(username) {
  try {
    const cookies = getCookies();
    // Using the web profile endpoint which is more compatible with browser cookies
    const config = {
      method: "GET",
      url: `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
      headers: {
        "User-Agent": getRandomUserAgent(),
        Cookie: cookies,
        "X-IG-App-ID": "936619743392459", // Standard App ID for Web
      },
      timeout: 15000,
    };
    const { data } = await retryWithBackoff(() => axios.request(config));
    if (!data.data || !data.data.user || !data.data.user.id) {
      throw new Error("User not found or profile is restricted.");
    }
    return data.data.user.id;
  } catch (err) {
    if (err.response && err.response.status === 404) {
      throw new Error(`Instagram user "${username}" does not exist.`);
    }
    throw new Error(`Could not find user ${username}: ${err.message}`);
  }
}

async function getCSRFToken() {
  try {
    // 1. Try to extract from environment variable cookies first
    const cookies = getCookies();
    if (cookies) {
      if (cookies.includes("csrftoken=")) {
        const match = cookies.match(/csrftoken=([^;]+)/);
        if (match && match[1]) {
          return match[1];
        }
      }
    }

    // 2. Fallback: Request main page to get cookies (only if we don't have them or they are incomplete)
    let config = {
      method: "GET",
      url: "https://www.instagram.com/",
      headers: {},
      timeout: 15000,
    };

    // If we have some cookies, send them, maybe we get a fresh csrf
    if (cookies) {
      config.headers["Cookie"] = cookies;
    }

    const response = await axios.request(config);

    if (response.headers["set-cookie"]) {
      const csrfCookie = response.headers["set-cookie"].find((c) =>
        c.includes("csrftoken")
      );
      if (csrfCookie) {
        return csrfCookie.split(";")[0].replace("csrftoken=", "");
      }
    }

    return "missing-token";
  } catch (err) {
    throw new Error(`Failed to obtain CSRF: ${err.message}`);
  }
}

async function instagramRequest(shortcode) {
  try {
    const BASE_URL = "https://www.instagram.com/graphql/query";
    const INSTAGRAM_DOCUMENT_ID = "9510064595728286";
    let dataBody = qs.stringify({
      variables: JSON.stringify({
        shortcode: shortcode,
        fetch_tagged_user_count: null,
        hoisted_comment_id: null,
        hoisted_reply_id: null,
      }),
      doc_id: INSTAGRAM_DOCUMENT_ID,
    });

    const token = await getCSRFToken();

    let config = {
      method: "post",
      url: BASE_URL,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-CSRFToken": token,
      },
      data: dataBody,
      timeout: 15000,
    };

    const cookies = getCookies();
    if (cookies) {
      config.headers["Cookie"] = cookies;
    }

    const { data } = await retryWithBackoff(() => axios.request(config));

    if (!data.data || !data.data.xdt_shortcode_media) {
      console.error("Instagram Response Error:", JSON.stringify(data));
      throw new Error(
        "Only posts/reels supported, check if your link is valid or if the account is private."
      );
    }

    return data.data.xdt_shortcode_media;
  } catch (err) {
    if (err.response) {
      console.error(
        "Instagram API Error:",
        err.response.status,
        err.response.data
      );
      if (err.response.status === 401) {
        throw new Error(
          "Instagram returned 401 Unauthorized. Session cookies may be invalid or missing."
        );
      }
    }
    throw new Error(`Failed instagram request: ${err.message}`);
  }
}

function formatPostInfo(requestData) {
  try {
    let mediaCapt = requestData.edge_media_to_caption.edges;
    const capt = mediaCapt.length === 0 ? "" : mediaCapt[0].node.text;
    return {
      owner_username: requestData.owner.username,
      owner_fullname: requestData.owner.full_name,
      is_verified: requestData.owner.is_verified,
      is_private: requestData.owner.is_private,
      likes: requestData.edge_media_preview_like.count,
      is_ad: requestData.is_ad,
      caption: capt,
    };
  } catch (err) {
    throw new Error(`Failed to format post info: ${err.message}`);
  }
}

function formatMediaDetails(mediaData) {
  try {
    if (mediaData.is_video) {
      return {
        type: "video",
        dimensions: mediaData.dimensions,
        video_view_count: mediaData.video_view_count,
        url: mediaData.video_url,
        thumbnail: mediaData.display_url,
      };
    } else {
      return {
        type: "image",
        dimensions: mediaData.dimensions,
        url: mediaData.display_url,
      };
    }
  } catch (err) {
    throw new Error(`Failed to format media details: ${err.message}`);
  }
}

function isSidecar(requestData) {
  return requestData["__typename"] == "XDTGraphSidecar";
}

function createOutputData(requestData) {
  try {
    let url_list = [],
      media_details = [];
    const IS_SIDECAR = isSidecar(requestData);
    if (IS_SIDECAR) {
      requestData.edge_sidecar_to_children.edges.forEach((media) => {
        media_details.push(formatMediaDetails(media.node));
        if (media.node.is_video) {
          url_list.push(media.node.video_url);
        } else {
          url_list.push(media.node.display_url);
        }
      });
    } else {
      media_details.push(formatMediaDetails(requestData));
      if (requestData.is_video) {
        url_list.push(requestData.video_url);
      } else {
        url_list.push(requestData.display_url);
      }
    }
    return {
      results_number: url_list.length,
      url_list,
      post_info: formatPostInfo(requestData),
      media_details,
    };
  } catch (err) {
    throw new Error(`Failed to create output data: ${err.message}`);
  }
}

// Fallback: Scrape profile from HTML (works without cookies on cloud)
async function scrapeProfileFromHTML(username) {
  try {
    const config = {
      method: "GET",
      url: `https://www.instagram.com/${username}/`,
      headers: {
        "User-Agent": getRandomUserAgent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Connection": "keep-alive",
      },
      timeout: 15000,
    };
    
    const { data: html } = await axios.request(config);
    
    // Try to find profile data in various script patterns
    let profileData = null;
    
    // Pattern 1: Look for meta tags (most reliable for public profiles)
    const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i) ||
                      html.match(/<meta\s+content="([^"]+)"\s+property="og:description"/i);
    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
                       html.match(/<meta\s+content="([^"]+)"\s+property="og:title"/i);
    const imageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i) ||
                       html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
    
    if (descMatch && titleMatch) {
      // Parse "123 Followers, 45 Following, 67 Posts - See Instagram photos..."
      const desc = descMatch[1];
      const title = titleMatch[1];
      const image = imageMatch ? imageMatch[1] : null;
      
      // Extract numbers from description
      const followersMatch = desc.match(/([\d,.]+[KMB]?)\s*Followers/i);
      const followingMatch = desc.match(/([\d,.]+[KMB]?)\s*Following/i);
      const postsMatch = desc.match(/([\d,.]+[KMB]?)\s*Posts/i);
      
      // Parse title: "Full Name (@username)"
      const nameMatch = title.match(/^(.+?)\s*\(@?(\w+)\)/);
      
      const parseCount = (str) => {
        if (!str) return 0;
        str = str.replace(/,/g, '');
        if (str.includes('K')) return Math.round(parseFloat(str) * 1000);
        if (str.includes('M')) return Math.round(parseFloat(str) * 1000000);
        if (str.includes('B')) return Math.round(parseFloat(str) * 1000000000);
        return parseInt(str) || 0;
      };
      
      profileData = {
        username: nameMatch ? nameMatch[2] : username,
        fullname: nameMatch ? nameMatch[1].trim() : username,
        biography: desc.split(' - See Instagram')[0].replace(/^[\d,.\s]+Followers,[\d,.\s]+Following,[\d,.\s]+Posts\s*[-–]\s*/i, '').trim() || "",
        profile_pic_url: image,
        is_private: desc.toLowerCase().includes('private'),
        is_verified: title.includes('✓') || html.includes('is_verified":true'),
        followers: parseCount(followersMatch ? followersMatch[1] : '0'),
        following: parseCount(followingMatch ? followingMatch[1] : '0'),
        posts_count: parseCount(postsMatch ? postsMatch[1] : '0'),
        external_url: null,
        category: null,
      };
    }
    
    // Pattern 2: Try to find JSON-LD data
    if (!profileData) {
      const ldMatch = html.match(/<script\s+type="application\/ld\+json"[^>]*>([^<]+)<\/script>/i);
      if (ldMatch) {
        try {
          const ld = JSON.parse(ldMatch[1]);
          if (ld.name || ld.alternateName) {
            profileData = {
              username: ld.alternateName?.replace('@', '') || username,
              fullname: ld.name || username,
              biography: ld.description || "",
              profile_pic_url: ld.image || null,
              is_private: false,
              is_verified: false,
              followers: ld.mainEntityofPage?.interactionStatistic?.find(s => s.interactionType?.includes('Follow'))?.userInteractionCount || 0,
              following: 0,
              posts_count: 0,
              external_url: ld.url || null,
              category: null,
            };
          }
        } catch (e) {}
      }
    }
    
    if (profileData && profileData.profile_pic_url) {
      return profileData;
    }
    
    throw new Error("Could not parse profile data from HTML");
  } catch (err) {
    throw new Error(`HTML scrape failed: ${err.message}`);
  }
}

async function getProfileByUsername(username) {
  // First try the API method
  try {
    const cookies = getCookies();
    const headers = {
      "User-Agent": getRandomUserAgent(),
      "X-IG-App-ID": "936619743392459",
    };
    
    // Only add cookies if available
    if (cookies) {
      headers.Cookie = cookies;
    }
    
    const config = {
      method: "GET",
      url: `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
      headers,
      timeout: 15000,
    };
    const { data } = await retryWithBackoff(() => axios.request(config));
    if (!data.data || !data.data.user) {
      throw new Error("User not found or profile is restricted.");
    }
    const user = data.data.user;
    return {
      username: user.username,
      fullname: user.full_name,
      biography: user.biography,
      profile_pic_url: user.profile_pic_url_hd,
      is_private: user.is_private,
      is_verified: user.is_verified,
      followers: user.edge_followed_by?.count || 0,
      following: user.edge_follow?.count || 0,
      posts_count: user.edge_owner_to_timeline_media?.count || 0,
      external_url: user.external_url,
      category: user.category_name,
    };
  } catch (apiErr) {
    // API failed, try HTML scraping as fallback
    console.log(`API failed for ${username}, trying HTML scrape...`);
    try {
      return await scrapeProfileFromHTML(username);
    } catch (scrapeErr) {
      // Both methods failed
      if (apiErr.response && apiErr.response.status === 404) {
        throw new Error(`Instagram user "${username}" does not exist.`);
      }
      throw new Error(
        `Could not fetch profile for ${username}: ${apiErr.message}`
      );
    }
  }
}

async function getProfilePictureByUsername(username) {
  // First try the API method
  try {
    const cookies = getCookies();
    const headers = {
      "User-Agent": getRandomUserAgent(),
      "X-IG-App-ID": "936619743392459",
    };
    
    // Only add cookies if available
    if (cookies) {
      headers.Cookie = cookies;
    }
    
    const config = {
      method: "GET",
      url: `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
      headers,
      timeout: 15000,
    };
    const { data } = await retryWithBackoff(() => axios.request(config));
    if (!data.data || !data.data.user) {
      throw new Error("User not found or profile is restricted.");
    }
    return {
      url: data.data.user.profile_pic_url_hd,
      username: data.data.user.username,
      fullname: data.data.user.full_name,
      is_private: data.data.user.is_private,
    };
  } catch (apiErr) {
    // API failed, try HTML scraping as fallback
    console.log(`API failed for PFP ${username}, trying HTML scrape...`);
    try {
      const profile = await scrapeProfileFromHTML(username);
      return {
        url: profile.profile_pic_url,
        username: profile.username,
        fullname: profile.fullname,
        is_private: profile.is_private,
      };
    } catch (scrapeErr) {
      if (apiErr.response && apiErr.response.status === 404) {
        throw new Error(`Instagram user "${username}" does not exist.`);
      }
      throw new Error(
        `Could not fetch profile picture for ${username}: ${apiErr.message}`
      );
    }
  }
}

async function getHighlightsByUsername(username) {
  try {
    const userId = await getUserId(username);
    const cookies = getCookies();
    if (!cookies) throw new Error("Cookies missing.");

    // 1. Fetch the list of highlight trays
    const trayConfig = {
      method: "GET",
      url: `https://i.instagram.com/api/v1/highlights/${userId}/highlights_tray/`,
      headers: {
        "User-Agent": getMobileInstagramUA(),
        Cookie: cookies,
      },
      timeout: 15000,
    };

    const { data: trayData } = await retryWithBackoff(() =>
      axios.request(trayConfig)
    );
    if (!trayData.tray || trayData.tray.length === 0) {
      throw new Error("No highlights found for this user.");
    }

    // 2. Extract reel IDs for all highlights
    const reelIds = trayData.tray.map((highlight) => highlight.id);

    // 3. Fetch all highlight media in one go
    const reelsConfig = {
      method: "POST",
      url: "https://i.instagram.com/api/v1/feed/reels_media/",
      headers: {
        "User-Agent": getMobileInstagramUA(),
        Cookie: cookies,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: qs.stringify({
        user_ids: reelIds,
      }),
      timeout: 20000,
    };

    const { data: reelsData } = await retryWithBackoff(() =>
      axios.request(reelsConfig)
    );
    if (!reelsData.reels || Object.keys(reelsData.reels).length === 0) {
      throw new Error("Could not fetch highlight media.");
    }

    // 4. Process the media from all reels
    let all_media_details = [];
    for (const reelId in reelsData.reels) {
      const reel = reelsData.reels[reelId];
      if (reel.items) {
        const media_details = reel.items.map((item) => {
          if (item.media_type === 1) {
            return {
              type: "image",
              url: item.image_versions2.candidates[0].url,
            };
          } else {
            return {
              type: "video",
              url: item.video_versions[0].url,
              thumbnail: item.image_versions2.candidates[0].url,
            };
          }
        });
        all_media_details = all_media_details.concat(media_details);
      }
    }

    if (all_media_details.length === 0) {
      throw new Error("Highlights contain no media or are inaccessible.");
    }

    return {
      results_number: all_media_details.length,
      post_info: {
        owner_username: username,
        caption: `Highlights from ${username}`,
      },
      media_details: all_media_details,
    };
  } catch (err) {
    throw new Error(`Failed to fetch highlights: ${err.message}`);
  }
}

async function getPostsByUsername(username, maxCount = 5) {
  try {
    const userId = await getUserId(username);
    const cookies = getCookies();
    if (!cookies) throw new Error("Cookies missing.");

    const config = {
      method: "GET",
      url: `https://i.instagram.com/api/v1/feed/user/${userId}/`,
      headers: {
        "User-Agent": getMobileInstagramUA(),
        Cookie: cookies,
      },
      timeout: 15000,
    };

    const { data } = await retryWithBackoff(() => axios.request(config));
    if (!data.items || data.items.length === 0) {
      throw new Error("No posts found for this user.");
    }

    const media_details = [];
    let postCount = 0;
    for (const item of data.items) {
      if (postCount >= maxCount) break;

      if (item.carousel_media) {
        item.carousel_media.forEach((media) => {
          if (media.media_type === 1) {
            media_details.push({
              type: "image",
              url: media.image_versions2.candidates[0].url,
            });
          } else {
            media_details.push({
              type: "video",
              url: media.video_versions[0].url,
              thumbnail: media.image_versions2.candidates[0].url,
            });
          }
        });
      } else if (item.media_type === 1) {
        media_details.push({
          type: "image",
          url: item.image_versions2.candidates[0].url,
        });
      } else if (item.media_type === 2) {
        media_details.push({
          type: "video",
          url: item.video_versions[0].url,
          thumbnail: item.image_versions2.candidates[0].url,
        });
      }
      postCount++;
    }

    return {
      results_number: media_details.length,
      post_info: {
        owner_username: username,
        caption: `Latest posts from ${username}`,
      },
      media_details,
    };
  } catch (err) {
    throw new Error(`Failed to fetch posts: ${err.message}`);
  }
}

module.exports = {
  instagramGetUrl,
  getStoriesByUsername,
  getProfilePictureByUsername,
  getProfileByUsername,
  getHighlightsByUsername,
  getPostsByUsername,
  setErrorMonitor,
};
