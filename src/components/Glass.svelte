<script lang="ts">
  let { children, class: className = '', interactive = false, frost = 0.13, radius = 24 } = $props<{
    children: any;
    class?: string;
    interactive?: boolean;
    frost?: number;
    radius?: number;
  }>();
</script>

<liquid-glass
  class={`glass ${interactive ? 'glass-interactive' : ''} ${className}`}
  radius={radius}
  frost={frost}
  blur="5"
  saturation="145"
  displace={interactive ? '3' : '2'}
  style="display:block;width:100%;height:100%;"
>
  {@render children()}
</liquid-glass>
