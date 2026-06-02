/**
 * frontend/src/services/api.js
 * LexAmplify Integration Services
 * Wraps backend Flask endpoints with standardized JWT injection and robust error catching.
 */

// Dynamically use environment variables for GCP serverless URLs, falling back to localhost
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';

/**
 * Generates authorization and content type headers.
 * If isFormData is true, browser sets the multi-part boundary, so content-type is omitted.
 */
const getHeaders = (isFormData = false) => {
  const headers = {};
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  // Support both standard 'token' and prefixed 'lexai_token' names
  const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

/**
 * Inspects responses and handles parsing or raises standard JS exceptions.
 */
const handleResponse = async (response) => {
  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorMessage;
    } catch (e) {
      // Handle cases where server returned plain text or html errors (like a 504 gateway timeout)
      try {
        const textError = await response.text();
        if (textError && textError.length < 200) {
          errorMessage = textError;
        }
      } catch (textErr) {
        // Fallback to default message
      }
    }
    throw new Error(errorMessage);
  }
  return await response.json();
};

/**
 * Uploads a document to the server, extracts raw text, and triggers RAG ingestion.
 * @param {File} file 
 * @param {number|string|null} caseId 
 * @param {string} tags 
 */
export const uploadDocument = async (file, caseId = null, tags = '') => {
  try {
    const formData = new FormData();
    formData.append('file', file);
    if (caseId) {
      formData.append('case_id', caseId);
    }
    if (tags) {
      formData.append('tags', tags);
    }

    const response = await fetch(`${API_BASE_URL}/api/documents/upload`, {
      method: 'POST',
      headers: getHeaders(true),
      body: formData,
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] uploadDocument error:', error);
    return {
      error: true,
      message: error.message || 'Failed to upload and index document due to network or server issues.'
    };
  }
};

/**
 * Fetches all document metadata belonging to the user, optionally filtered by caseId.
 * @param {number|string|null} caseId 
 */
export const fetchDocuments = async (caseId = null) => {
  try {
    let url = `${API_BASE_URL}/api/documents`;
    if (caseId) {
      url += `?case_id=${caseId}`;
    }
    const response = await fetch(url, {
      method: 'GET',
      headers: getHeaders(),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] fetchDocuments error:', error);
    return {
      error: true,
      message: error.message || 'Failed to retrieve case documents.'
    };
  }
};

/**
 * Deletes a document from the vault and automatically wipes matching RAG chunks.
 * @param {number|string} docId 
 */
export const deleteDocument = async (docId) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/documents/${docId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] deleteDocument error:', error);
    return {
      error: true,
      message: error.message || 'Failed to delete document from server.'
    };
  }
};

/**
 * Fetches a single document's full details (with text reconstructed from RAG chunks).
 * @param {number|string} docId 
 */
export const fetchDocumentDetails = async (docId) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/documents/${docId}`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] fetchDocumentDetails error:', error);
    return {
      error: true,
      message: error.message || 'Failed to retrieve document text details.'
    };
  }
};

/**
 * Queries the Universal RAG Chatbot with Indian Law wrapper constraints.
 * @param {string} query 
 * @param {string} scope - "all_cases" | "current_case" | "open_document"
 * @param {number|string|null} caseId 
 * @param {number|string|null} documentId 
 */
export const queryRAGChat = async (query, scope = 'all_cases', caseId = null, documentId = null) => {
  try {
    const body = { query, scope };
    if (caseId) {
      body.case_id = caseId;
    }
    if (documentId) {
      body.document_id = documentId;
    }

    const response = await fetch(`${API_BASE_URL}/api/ai/rag-chat`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] queryRAGChat error:', error);
    return {
      error: true,
      message: error.message || 'Failed to process legal query. The reasoning engine may be offline or timing out.'
    };
  }
};

/**
 * Fetches global court statistics, virtual court numbers, and upcoming events.
 */
export const fetchCourtGlobals = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/court-globals`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] fetchCourtGlobals error:', error);
    return {
      error: true,
      message: error.message || 'Failed to retrieve global court details.'
    };
  }
};

/**
 * Fetches High Court information, judges roster, and forms for a specific state.
 * @param {string} state 
 */
export const fetchCourtData = async (state) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/court-data/${state}`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] fetchCourtData error:', error);
    return {
      error: true,
      message: error.message || `Failed to retrieve court details for ${state}.`
    };
  }
};

/**
 * Fetches the district court database.
 */
export const fetchDistricts = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/districts`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] fetchDistricts error:', error);
    return {
      error: true,
      message: error.message || 'Failed to retrieve district court details.'
    };
  }
};

/**
 * Fetches causelist details from the CMS backend via CNR.
 * @param {string} cnrNumber 
 */
export const fetchCauselist = async (cnrNumber) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/causelist/fetch`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ cnr_number: cnrNumber }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] fetchCauselist error:', error);
    return {
      error: true,
      message: error.message || 'Failed to fetch causelist details.'
    };
  }
};

/**
 * Fetches tracked cases from the CMS backend.
 */
export const fetchTrackedCases = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/causelist/list`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] fetchTrackedCases error:', error);
    return {
      error: true,
      message: error.message || 'Failed to fetch tracked cases.'
    };
  }
};

/**
 * Saves a new manually added case to the CMS.
 * @param {object} caseData
 */
export const saveTrackedCase = async (caseData) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/causelist/save`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(caseData),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] saveTrackedCase error:', error);
    return {
      error: true,
      message: error.message || 'Failed to save tracked case.'
    };
  }
};

/**
 * Fetches detailed page scrape content for a legal event.
 * @param {string} eventId 
 */
export const fetchEventDetails = async (eventId) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/events/${encodeURIComponent(eventId)}`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] fetchEventDetails error:', error);
    return {
      error: true,
      message: error.message || 'Failed to retrieve event details.'
    };
  }
};

/**
 * Calculates the required court fee based on suit amount and type.
 * @param {number} amount 
 * @param {string} courtType 
 */
export const calculateCourtFee = async (amount, courtType) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/calculate-fee`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ amount, court_type: courtType }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] calculateCourtFee error:', error);
    return {
      error: true,
      message: error.message || 'Failed to calculate court fee.'
    };
  }
};

/**
 * Fetches all IP assets for the authenticated user.
 */
export const fetchIPAssets = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/ip/list`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] fetchIPAssets error:', error);
    return {
      error: true,
      message: error.message || 'Failed to retrieve tracked IP assets.'
    };
  }
};

/**
 * Tracks a new IP asset (trademark, patent, copyright, design).
 * @param {object} asset 
 */
export const addIPAsset = async (asset) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/ip/add`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(asset),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] addIPAsset error:', error);
    return {
      error: true,
      message: error.message || 'Failed to save new IP asset.'
    };
  }
};

/**
 * Updates an existing IP asset by ID.
 * @param {number|string} id 
 * @param {object} asset 
 */
export const updateIPAsset = async (id, asset) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/ip/update/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(asset),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] updateIPAsset error:', error);
    return {
      error: true,
      message: error.message || 'Failed to update IP asset.'
    };
  }
};

/**
 * Permanently deletes a tracked IP asset.
 * @param {number|string} id 
 */
export const deleteIPAsset = async (id) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/ip/delete/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] deleteIPAsset error:', error);
    return {
      error: true,
      message: error.message || 'Failed to delete IP asset.'
    };
  }
};

/**
 * Sends a contract file or pasted text to the backend to run risk analysis.
 * @param {File|null} file 
 * @param {string} text 
 * @param {string} scanStrategy 
 */
export const analyzeContract = async (file = null, text = '', scanStrategy = 'Defensive') => {
  try {
    let response;
    if (file) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('scanStrategy', scanStrategy);
      response = await fetch(`${API_BASE_URL}/api/contract/analyze`, {
        method: 'POST',
        headers: getHeaders(true),
        body: formData,
      });
    } else {
      response = await fetch(`${API_BASE_URL}/api/contract/analyze`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ text, scanStrategy }),
      });
    }
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] analyzeContract error:', error);
    return {
      error: true,
      message: error.message || 'Failed to analyze contract.'
    };
  }
};

/**
 * Rewrites a high-risk clause based on a specified user intent.
 * @param {string} originalClause 
 * @param {string} issue 
 * @param {string} userIntent 
 */
export const rewriteContractClause = async (originalClause, issue, userIntent) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/contract/rewrite`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ original_clause: originalClause, issue, user_intent: userIntent }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] rewriteContractClause error:', error);
    return {
      error: true,
      message: error.message || 'Failed to rewrite clause.'
    };
  }
};

/**
 * Generates an executive summary of the contract text.
 * @param {string} rawText 
 */
export const fetchContractSummary = async (rawText) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/contract/summary`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ raw_text: rawText }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] fetchContractSummary error:', error);
    return {
      error: true,
      message: error.message || 'Failed to fetch contract summary.'
    };
  }
};

/**
 * Identifies missing standard clauses under Indian Law for a given contract.
 * @param {string} rawText 
 */
export const fetchContractRecommendations = async (rawText) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/contract/recommendations`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ raw_text: rawText }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] fetchContractRecommendations error:', error);
    return {
      error: true,
      message: error.message || 'Failed to fetch contract extensions.'
    };
  }
};

/**
 * Submits queries grounded strictly in the active contract text.
 * @param {string} rawText 
 * @param {string} query 
 */
export const chatWithContract = async (rawText, query) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/contract/chat`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ raw_text: rawText, query }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] chatWithContract error:', error);
    return {
      error: true,
      message: error.message || 'Failed to send chat message.'
    };
  }
};

/**
 * Exports contract data to PDF or DOCX format.
 * @param {string} documentText 
 * @param {string} draftText 
 * @param {string} format 
 */
export const exportContract = async (documentText, draftText, format = 'pdf') => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/contract/export`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ document_text: documentText, draft_text: draftText, format }),
    });
    if (!response.ok) {
      throw new Error(`Export failed with status ${response.status}`);
    }
    return await response.blob();
  } catch (error) {
    console.error('[API Service] exportContract error:', error);
    throw error;
  }
};

/**
 * Runs a conflict check on a specified entity name against client databases and case documents.
 * @param {string} entityName 
 */
export const runConflictCheck = async (entityName) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/conflict/check`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ entity_name: entityName }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] runConflictCheck error:', error);
    return {
      error: true,
      message: error.message || 'Conflict check failed. Connection timed out or server is offline.'
    };
  }
};

/**
 * Runs a cross-document conflict check on uploaded files.
 * @param {FormData} formData 
 */
export const analyzeConflicts = async (formData) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/conflict/analyze`, {
      method: 'POST',
      headers: getHeaders(true), // true for isFormData
      body: formData,
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] analyzeConflicts error:', error);
    return {
      error: true,
      message: error.message || 'Cross-document conflict analysis failed.'
    };
  }
};

/**
 * Sends a universal RAG chat request with dynamic context.
 * Parses dynamic route parameters to figure out the correct RAG scope.
 * @param {object} payload - { query, currentPath, params }
 */
export const sendUniversalChat = async (payload) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getHeaders()
      },
      body: JSON.stringify(payload),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('[API Service] sendUniversalChat error:', error);
    return {
      error: true,
      message: error.message || 'Universal Agent Chat failed. Connection timed out or server is offline.'
    };
  }
};



