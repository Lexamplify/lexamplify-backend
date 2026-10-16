import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout, { Icon } from './MarketingLayout';

export default function NotFoundPage() {
  // A missing page should never be indexed.
  useEffect(() => {
    const m = document.createElement('meta');
    m.name = 'robots'; m.content = 'noindex';
    document.head.appendChild(m);
    return () => { m.remove(); };
  }, []);
  return (
    <MarketingLayout title="Page not found · LexAmplify" description="This page does not exist.">
      <section className="nf">
        <div className="wrap">
          <p className="eyebrow">Error 404</p>
          <h1>That page is not in the file.</h1>
          <p className="lede">The link may be old or mistyped. Head back to the homepage, or sign in to your workspace.</p>
          <div className="btn-row">
            <Link to="/" className="btn btn--primary btn--lg">Back to the homepage <Icon name="arrow" size={18} /></Link>
            <Link to="/login" className="btn btn--ghost btn--lg">Sign in</Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
