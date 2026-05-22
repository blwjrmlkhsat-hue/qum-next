 
export default function Home() {
  return (
    <main style={{
      minHeight: '100vh',
      background: '#080C14',
      color: '#E8EEF8',
      fontFamily: 'Cairo, sans-serif',
      direction: 'rtl'
    }}>
      {/* NAV */}
      <nav style={{
        padding: '1rem 5%',
        borderBottom: '1px solid rgba(255,255,255,.07)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(8,12,20,.96)'
      }}>
        <div style={{fontSize: '1.5rem', fontWeight: 900, color: '#3B82F6'}}>قُم</div>
        <div style={{display: 'flex', gap: '1rem'}}>
          <a href="#books" style={{color: '#6B7FA8', textDecoration: 'none'}}>الكتب</a>
          <a href="#pricing" style={{color: '#6B7FA8', textDecoration: 'none'}}>الباقات</a>
          <a href="#contact" style={{color: '#6B7FA8', textDecoration: 'none'}}>تواصل</a>
        </div>
      </nav>

      {/* HERO */}
      <section style={{
        textAlign: 'center',
        padding: '6rem 5%',
        background: 'radial-gradient(ellipse 700px 500px at 50% 0%, rgba(37,99,235,.13), transparent)'
      }}>
        <div style={{
          display: 'inline-block',
          background: 'rgba(37,99,235,.1)',
          border: '1px solid rgba(59,130,246,.3)',
          padding: '.4rem 1rem',
          borderRadius: '50px',
          fontSize: '.8rem',
          color: '#60A5FA',
          marginBottom: '1.5rem'
        }}>
          📚 أكثر من 200 قارئ غيّروا حياتهم
        </div>
        <h1 style={{
          fontSize: 'clamp(2rem,5vw,4rem)',
          fontWeight: 900,
          lineHeight: 1.3,
          marginBottom: '1.5rem'
        }}>
          كتبك للنهوض النفسي —<br/>
          <span style={{color: '#3B82F6'}}>اشتر مرة واقرأ للأبد</span>
        </h1>
        <p style={{color: '#6B7FA8', fontSize: '1.1rem', maxWidth: '500px', margin: '0 auto 2rem', lineHeight: 1.8}}>
          اختر كتابك وادفع بأمان — تجده فوراً في مكتبتك الشخصية على أي جهاز
        </p>
        <div style={{display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap'}}>
          <a href="#books" style={{
            background: 'linear-gradient(135deg,#2563EB,#3B82F6)',
            color: '#fff',
            padding: '.9rem 2rem',
            borderRadius: '10px',
            fontWeight: 700,
            textDecoration: 'none',
            fontSize: '1rem'
          }}>📖 استعرض الكتب</a>
          <a href="#pricing" style={{
            border: '1.5px solid rgba(59,130,246,.3)',
            color: '#E8EEF8',
            padding: '.9rem 2rem',
            borderRadius: '10px',
            fontWeight: 600,
            textDecoration: 'none',
            fontSize: '1rem'
          }}>💎 الباقات</a>
        </div>
      </section>

      {/* STATS */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4,1fr)',
        background: '#111827',
        borderTop: '1px solid rgba(255,255,255,.07)',
        borderBottom: '1px solid rgba(255,255,255,.07)'
      }}>
        {[
          {num: '+200', label: 'قارئ مستفيد'},
          {num: '+50', label: 'كتاب مختار'},
          {num: '10+', label: 'دولة'},
          {num: '98%', label: 'رضا القراء'},
        ].map((s, i) => (
          <div key={i} style={{
            padding: '2rem 1rem',
            textAlign: 'center',
            borderLeft: i < 3 ? '1px solid rgba(255,255,255,.07)' : 'none'
          }}>
            <div style={{
              fontSize: '2rem',
              fontWeight: 900,
              background: 'linear-gradient(135deg,#3B82F6,#60A5FA)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>{s.num}</div>
            <div style={{color: '#6B7FA8', fontSize: '.85rem', marginTop: '.3rem'}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* BOOKS */}
      <section id="books" style={{padding: '5rem 5%', background: '#080C14'}}>
        <div style={{textAlign: 'center', marginBottom: '3rem'}}>
          <div style={{color: '#60A5FA', fontSize: '.75rem', fontWeight: 700, letterSpacing: '2px', marginBottom: '.5rem'}}>✦ مجموعتنا</div>
          <h2 style={{fontSize: '2.2rem', fontWeight: 900, marginBottom: '.8rem'}}>كتب تُغيّر حياتك</h2>
          <p style={{color: '#6B7FA8'}}>ادفع مرة واقرأ للأبد من حسابك</p>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))',
          gap: '1.2rem',
          maxWidth: '1100px',
          margin: '0 auto'
        }}>
          {[
            {emoji: '🧠', title: 'كتب علم النفس', desc: 'فهم عميق لطبيعة النفس البشرية', price: 49, badge: ''},
            {emoji: '💡', title: 'كتب التفكير الإيجابي', desc: 'أدوات عملية لبرمجة عقلك على النجاح', price: 49, badge: ''},
            {emoji: '🛡️', title: 'كتب الصحة النفسية', desc: 'دليلك لفهم القلق والاكتئاب', price: 49, badge: 'الأكثر طلباً'},
            {emoji: '🔥', title: 'كتب التحفيز', desc: 'أشعل حماسك وحافظ عليه', price: 49, badge: ''},
            {emoji: '🌱', title: 'كتب بناء العادات', desc: 'علّم نفسك بناء عادات تغير حياتك', price: 49, badge: 'جديد'},
            {emoji: '🤝', title: 'كتب العلاقات', desc: 'فن التواصل وبناء علاقات صحية', price: 29, badge: ''},
          ].map((b, i) => (
            <div key={i} style={{
              background: '#111827',
              border: '1px solid rgba(255,255,255,.07)',
              borderRadius: '20px',
              padding: '1.8rem',
              position: 'relative',
              transition: 'transform .3s'
            }}>
              {b.badge && <div style={{
                position: 'absolute', top: '1rem', left: '1rem',
                background: 'linear-gradient(135deg,#2563EB,#3B82F6)',
                color: '#fff', padding: '.15rem .6rem',
                borderRadius: '50px', fontSize: '.68rem', fontWeight: 700
              }}>{b.badge}</div>}
              <div style={{fontSize: '2.5rem', marginBottom: '1rem'}}>{b.emoji}</div>
              <h3 style={{fontSize: '1rem', fontWeight: 700, marginBottom: '.4rem'}}>{b.title}</h3>
              <p style={{color: '#6B7FA8', fontSize: '.85rem', lineHeight: 1.7, marginBottom: '1rem'}}>{b.desc}</p>
              <div style={{fontSize: '1.2rem', fontWeight: 900, color: '#60A5FA', marginBottom: '.8rem'}}>
                {b.price} <span style={{fontSize: '.8rem', color: '#6B7FA8'}}>ر.س</span>
              </div>
              <button style={{
                width: '100%', padding: '.6rem',
                background: 'rgba(37,99,235,.12)',
                border: '1.5px solid rgba(59,130,246,.3)',
                color: '#60A5FA', borderRadius: '10px',
                fontSize: '.85rem', fontWeight: 700, cursor: 'pointer'
              }}>+ أضف للسلة</button>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{padding: '5rem 5%', background: '#0D1220'}}>
        <div style={{textAlign: 'center', marginBottom: '3rem'}}>
          <div style={{color: '#60A5FA', fontSize: '.75rem', fontWeight: 700, letterSpacing: '2px', marginBottom: '.5rem'}}>✦ الباقات</div>
          <h2 style={{fontSize: '2.2rem', fontWeight: 900}}>اختر باقتك</h2>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))',
          gap: '1.2rem',
          maxWidth: '960px',
          margin: '0 auto'
        }}>
          {[
            {name: 'كتاب واحد', price: 29, features: ['قراءة فورية', 'دعم واتساب'], popular: false},
            {name: 'باقة 3 كتب', price: 69, features: ['3 كتب في مكتبتك', 'قراءة من أي جهاز', 'دعم واتساب'], popular: false},
            {name: 'الباقة المميزة', price: 99, features: ['3 كتب + ملخص صوتي', 'قراءة من أي جهاز', 'دعم VIP'], popular: true},
            {name: 'المكتبة الكاملة', price: 149, features: ['كل الكتب', 'قراءة مدى الحياة', 'تحديثات مجانية'], popular: false},
          ].map((p, i) => (
            <div key={i} style={{
              background: '#111827',
              border: p.popular ? '2px solid #3B82F6' : '1px solid rgba(255,255,255,.07)',
              borderRadius: '20px',
              padding: '1.8rem',
              position: 'relative',
              boxShadow: p.popular ? '0 0 30px rgba(37,99,235,.2)' : 'none'
            }}>
              {p.popular && <div style={{
                position: 'absolute', top: '-13px', left: '50%', transform: 'translateX(-50%)',
                background: 'linear-gradient(135deg,#2563EB,#3B82F6)',
                color: '#fff', padding: '.3rem 1.2rem',
                borderRadius: '50px', fontSize: '.75rem', fontWeight: 800, whiteSpace: 'nowrap'
              }}>⭐ الأكثر طلباً</div>}
              <div style={{fontSize: '.82rem', color: '#6B7FA8', marginBottom: '.5rem'}}>{p.name}</div>
              <div style={{fontSize: '2.5rem', fontWeight: 900, color: '#60A5FA', marginBottom: '1.2rem'}}>
                {p.price} <span style={{fontSize: '.9rem', color: '#6B7FA8'}}>ر.س</span>
              </div>
              <ul style={{listStyle: 'none', marginBottom: '1.5rem'}}>
                {p.features.map((f, j) => (
                  <li key={j} style={{
                    padding: '.4rem 0',
                    borderBottom: '1px solid rgba(255,255,255,.07)',
                    fontSize: '.85rem',
                    display: 'flex', alignItems: 'center', gap: '.5rem'
                  }}>
                    <span style={{color: '#22C55E', fontWeight: 700}}>✓</span> {f}
                  </li>
                ))}
              </ul>
              <button style={{
                width: '100%', padding: '.85rem',
                background: p.popular ? 'linear-gradient(135deg,#2563EB,#3B82F6)' : 'transparent',
                border: p.popular ? 'none' : '1.5px solid rgba(59,130,246,.3)',
                color: p.popular ? '#fff' : '#60A5FA',
                borderRadius: '10px', fontWeight: 700, cursor: 'pointer', fontSize: '.92rem'
              }}>{p.popular ? '🚀 اشتر الآن' : '🛒 اشتر الآن'}</button>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{
        background: '#0D1220',
        borderTop: '1px solid rgba(255,255,255,.07)',
        padding: '2.5rem 5%',
        textAlign: 'center'
      }}>
        <div style={{fontSize: '2rem', fontWeight: 900, color: '#3B82F6', marginBottom: '.5rem'}}>قُم</div>
        <p style={{color: '#6B7FA8', fontSize: '.85rem'}}>كتب تنهض بروحك</p>
        <p style={{color: '#6B7FA8', fontSize: '.75rem', marginTop: '.5rem'}}>© 2025 قُم — جميع الحقوق محفوظة</p>
      </footer>
    </main>
  );
}