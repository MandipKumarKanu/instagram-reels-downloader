const axios = require("axios");
const qs = require("qs");

async function instagramGetUrl(url_media) {
  return new Promise(async (resolve, reject) => {
    try {
      url_media = await checkRedirect(url_media);
      const SHORTCODE = getShortcode(url_media);
      const INSTAGRAM_REQUEST = await instagramRequest(SHORTCODE);
      const OUTPUT_DATA = createOutputData(INSTAGRAM_REQUEST);
      resolve(OUTPUT_DATA);
    } catch (err) {
      reject(err);
    }
  });
}

function getCookies() {
  // Return the full cookie string from env var
  return process.env.INSTAGRAM_COOKIES || "";
}

async function checkRedirect(url) {
  const headers = {};
  const cookies = getCookies();
  if (cookies) {
    headers["Cookie"] = cookies;
  }

  if (url.includes("/share/") || url.includes("share")) {
    try {
      let res = await axios.get(url, { headers });
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
    };

    const cookies = getCookies();
    if (cookies) {
      config.headers["Cookie"] = cookies;
    }

    const { data } = await axios.request(config);

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

module.exports = { instagramGetUrl };
