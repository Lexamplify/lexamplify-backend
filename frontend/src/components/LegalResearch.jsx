import React, { useState } from 'react';

const LegalResearch = () => {
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!query.trim()) return;

        setLoading(true);
        setError(null);
        setResult(null);

        try {
            const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'}/api/legal-research`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ question: query }),
            });

            const data = await response.json();

            if (!response.ok || data.error) {
                throw new Error(data.message || 'Something went wrong');
            }

            setResult(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto p-6 bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800">
            <div className="mb-8">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Firm Library Search</h2>
                <p className="text-gray-600 dark:text-gray-400">Query your proprietary vector database for legal precedents.</p>
            </div>

            <form onSubmit={handleSearch} className="mb-8">
                <div className="flex gap-4">
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="e.g., What happens if a cheque bounces due to insufficient funds?"
                        className="flex-1 p-4 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                        disabled={loading}
                    />
                    <button
                        type="submit"
                        disabled={loading || !query.trim()}
                        className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
                    >
                        {loading ? 'Searching...' : 'Research'}
                    </button>
                </div>
            </form>

            {error && (
                <div className="p-4 mb-6 text-red-700 bg-red-100 rounded-lg">
                    Error: {error}
                </div>
            )}

            {result && (
                <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">LexAmplify AI Analysis</h3>
                    <p className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap mb-6">
                        {result.answer}
                    </p>

                    {result.sources && result.sources.length > 0 && (
                        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                            <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Sources Cited</h4>
                            <ul className="space-y-2">
                                {result.sources.map((source, index) => (
                                    <li key={index} className="flex items-center text-sm text-blue-600 dark:text-blue-400">
                                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                                        {source}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default LegalResearch;