import { CharactersSection } from './characters/CharactersSection';
import { FontsSection } from './fonts/FontsSection';
import { PlanPanel } from './plan/PlanPanel';
import { PlanSheet } from './plan/PlanSheet';
import { useMediaQuery } from './utils';

export function Workbench() {
  // 计划面板只渲染一份：大屏在右侧常驻，小屏在底部抽屉里。
  const wide = useMediaQuery('(min-width: 1024px)', true);
  return (
    <div className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="grid min-w-0 content-start gap-5">
        <FontsSection />
        <CharactersSection />
      </div>
      {wide ? (
        <aside className="scrollbar-thin min-w-0 lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100vh-5rem)] lg:self-start lg:overflow-y-auto">
          <PlanPanel />
        </aside>
      ) : (
        <PlanSheet />
      )}
    </div>
  );
}
